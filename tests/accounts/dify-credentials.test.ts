import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient, type Document } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  acquireAppCredential,
  executionKey,
} from "../../src/lib/server/runs/credentials";
import { orchestratorSchema } from "../../src/lib/contracts/runs";
import { AppError } from "../../src/lib/auth-policy";
import { executionBinding } from "../../src/lib/server/runs/provider";
import { bindingTestEnvironment } from "./fixtures/environment-binding";
import { environmentMcpConfiguration } from "../../src/lib/server/runs/environment-binding";

test("Dify app credentials: reuse first, encrypted persistence, isolation and uncertain creation", async (t) => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("dify_credentials");
  const actor = {
    uid: "fixture-admin",
    auth_time: Math.floor(Date.now() / 1000),
  };
  const env = {
    ...bindingTestEnvironment,
    DIFY_CONSOLE_URL: "https://dify.example.test/console/api",
    DIFY_BASE_URL: "https://dify.example.test/v1",
    DIFY_WORKSPACE_ID: randomUUID(),
    DIFY_MANAGEMENT_KEY: "management-private-canary",
  };
  await db.collection<Document & { _id: string }>("accountAccess").insertOne({
    _id: actor.uid,
    role: "admin",
    status: "active",
    notBefore: 0,
    revision: 0,
  });
  const definition = (appId: string, credentialId?: string) =>
    orchestratorSchema.parse({
      id: "fixture",
      name: "Fixture",
      description: "",
      order: 0,
      keyEnv: "DIFY_KEY_FIXTURE",
      appId,
      environmentBinding: environmentMcpConfiguration(env).binding,
      credentialId,
      enabled: false,
      inputs: [],
      pricing: null,
      recovery: null,
    });
  const existing = { id: randomUUID(), token: "app-existing-secret-canary" };
  try {
    await t.test(
      "existing key is fetched without a creation request or plaintext persistence",
      async () => {
        const appId = randomUUID();
        const paths: string[] = [];
        const result = await acquireAppCredential(
          appId,
          actor,
          db,
          async (path, options) => {
            paths.push(path);
            assert.equal(options?.body, undefined);
            return path.endsWith("api-keys")
              ? { data: [existing] }
              : { mode: "workflow" };
          },
          env,
        );
        assert.equal(result.source, "existing");
        assert.equal(paths.length, 2);
        assert.equal(
          await executionKey(definition(appId, result.credentialId), db, env),
          existing.token,
        );
        for (const name of [
          "difyCredentials",
          "difyCredentialAcquisitions",
          "auditEvents",
        ])
          assert.ok(
            !JSON.stringify(
              await db.collection(name).find().toArray(),
            ).includes(existing.token),
          );
        assert.ok(!JSON.stringify(result).includes(existing.token));
        await assert.rejects(
          executionKey(definition(randomUUID(), result.credentialId), db, env),
          /unavailable/,
        );
        await assert.rejects(
          executionKey(definition(appId, result.credentialId), db, {
            ...env,
            DIFY_WORKSPACE_ID: randomUUID(),
          }),
          /unavailable/,
        );
        await assert.rejects(
          executionKey(definition(appId, result.credentialId), db, {
            ...env,
            DIFY_MANAGEMENT_KEY: "rotated",
          }),
          /cannot be read/,
        );
        await db
          .collection<Document & { _id: string }>("difyCredentials")
          .updateOne(
            { _id: result.credentialId },
            { $set: { ciphertext: "dGFtcGVyZWQ=" } },
          );
        await assert.rejects(
          executionKey(definition(appId, result.credentialId), db, env),
          /cannot be read/,
        );
      },
    );
    await t.test(
      "empty list creates exactly one key; subsequent registration reuses it",
      async () => {
        const appId = randomUUID();
        const keys: (typeof existing)[] = [];
        let creates = 0;
        const request = async (path: string, options?: { body?: unknown }) => {
          if (!path.endsWith("api-keys")) return { mode: "workflow" };
          if (options?.body !== undefined) {
            creates++;
            keys.push({ id: randomUUID(), token: "app-created-secret-canary" });
            return keys[0];
          }
          return { data: keys };
        };
        const created = await acquireAppCredential(
          appId,
          actor,
          db,
          request,
          env,
        );
        const reused = await acquireAppCredential(
          appId,
          actor,
          db,
          request,
          env,
        );
        assert.equal(created.source, "created");
        assert.equal(reused.source, "existing");
        assert.equal(creates, 1);
        assert.equal(reused.credentialId, created.credentialId);
        assert.equal(
          await executionKey(definition(appId, created.credentialId), db, env),
          keys[0].token,
        );
      },
    );
    await t.test("concurrent requests do not both create a key", async () => {
      const appId = randomUUID();
      let unblock!: () => void;
      let entered!: () => void;
      const paused = new Promise<void>((resolve) => {
        unblock = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let creates = 0;
      const first = acquireAppCredential(
        appId,
        actor,
        db,
        async (path, options) => {
          if (!path.endsWith("api-keys")) {
            entered();
            await paused;
            return { mode: "workflow" };
          }
          if (options?.body !== undefined) {
            creates++;
            return existing;
          }
          return { data: [] };
        },
        env,
      );
      await started;
      await assert.rejects(
        acquireAppCredential(
          appId,
          actor,
          db,
          async () => {
            throw new Error("Must not contact provider");
          },
          env,
        ),
        /already being connected/,
      );
      unblock();
      await first;
      assert.equal(creates, 1);
    });
    await t.test(
      "lost creation responses reconcile the list and never blindly create again",
      async () => {
        const appId = randomUUID();
        let creates = 0;
        let listed: (typeof existing)[] = [];
        const request = async (path: string, options?: { body?: unknown }) => {
          if (!path.endsWith("api-keys")) return { mode: "workflow" };
          if (options?.body !== undefined) {
            creates++;
            throw new AppError("DIFY_OUTCOME_UNKNOWN", "Unknown creation", 503);
          }
          return { data: listed };
        };
        await assert.rejects(
          acquireAppCredential(appId, actor, db, request, env),
          /Unknown creation/,
        );
        await assert.rejects(
          acquireAppCredential(appId, actor, db, request, env),
          /previous key creation/,
        );
        assert.equal(creates, 1);
        listed = [existing];
        assert.equal(
          (await acquireAppCredential(appId, actor, db, request, env)).source,
          "existing",
        );
        assert.equal(creates, 1);
      },
    );
    await t.test(
      "forbidden/malformed lists and unsupported apps do not create keys",
      async () => {
        for (const kind of ["forbidden", "invalid", "chat"] as const) {
          let creates = 0;
          await assert.rejects(
            acquireAppCredential(
              randomUUID(),
              actor,
              db,
              async (path, options) => {
                if (options?.body !== undefined) creates++;
                if (kind === "chat") return { mode: "chat" };
                if (!path.endsWith("api-keys")) return { mode: "workflow" };
                if (kind === "forbidden")
                  throw new AppError("DIFY_REJECTED", "Forbidden", 409);
                return { data: "not-a-list" };
              },
              env,
            ),
          );
          assert.equal(creates, 0);
        }
      },
    );
    await t.test(
      "known creation rejection can be retried after permissions are fixed",
      async () => {
        const appId = randomUUID();
        let reject = true;
        const request = async (path: string, options?: { body?: unknown }) => {
          if (!path.endsWith("api-keys")) return { mode: "workflow" };
          if (options?.body === undefined) return { data: [] };
          if (reject)
            throw new AppError(
              "DIFY_KEY_CREATION_REJECTED",
              "Creation denied",
              409,
            );
          return existing;
        };
        await assert.rejects(
          acquireAppCredential(appId, actor, db, request, env),
          /Creation denied/,
        );
        reject = false;
        const result = await acquireAppCredential(
          appId,
          actor,
          db,
          request,
          env,
        );
        assert.equal(result.source, "created");
        const stableEnv = {
          ...env,
          DIFY_CREDENTIAL_ENCRYPTION_KEY: "a".repeat(64),
        };
        const reconnected = await acquireAppCredential(
          appId,
          actor,
          db,
          async (path) =>
            path.endsWith("api-keys")
              ? { data: [existing] }
              : { mode: "workflow" },
          stableEnv,
        );
        assert.equal(
          await executionKey(definition(appId, reconnected.credentialId), db, {
            ...stableEnv,
            DIFY_MANAGEMENT_KEY: "rotated",
          }),
          existing.token,
        );
      },
    );
    await t.test(
      "workers resolve saved keys without app variables and retain earlier credentials",
      async () => {
        const appId = randomUUID();
        let token = "app-first-snapshot-canary";
        const keyId = randomUUID();
        const request = async (path: string) =>
          path.endsWith("api-keys")
            ? { data: [{ id: keyId, token }] }
            : { mode: "workflow" };
        const first = await acquireAppCredential(
          appId,
          actor,
          db,
          request,
          env,
        );
        const oldDefinition = {
          ...definition(appId, first.credentialId),
          workflowId: randomUUID(),
        };
        const original = Object.fromEntries(
          [...Object.keys(env), "DIFY_MODE"].map((name) => [
            name,
            process.env[name],
          ]),
        );
        Object.assign(process.env, env, { DIFY_MODE: "live" });
        try {
          const before = await executionBinding(oldDefinition, 1, db);
          assert.equal(before.binding.apiKey, token);
          assert.ok(!JSON.stringify(before.snapshot).includes(token));
          token = "app-second-snapshot-canary";
          const second = await acquireAppCredential(
            appId,
            actor,
            db,
            request,
            env,
          );
          assert.notEqual(second.credentialId, first.credentialId);
          const after = await executionBinding(oldDefinition, 1, db);
          assert.equal(after.snapshot.fingerprint, before.snapshot.fingerprint);
          assert.equal(after.binding.apiKey, "app-first-snapshot-canary");
        } finally {
          for (const [name, value] of Object.entries(original)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
          }
        }
      },
    );
    await t.test(
      "manual credentials still resolve, and revoked admins cannot provision",
      async () => {
        assert.equal(
          await executionKey(definition(randomUUID()), db, {
            DIFY_KEY_FIXTURE: "manual-canary",
          }),
          "manual-canary",
        );
        await db
          .collection<Document & { _id: string }>("accountAccess")
          .updateOne({ _id: actor.uid }, { $set: { role: "member" } });
        await assert.rejects(
          acquireAppCredential(
            randomUUID(),
            actor,
            db,
            async () => {
              throw new Error("Must not contact provider");
            },
            env,
          ),
          /Administrator/,
        );
      },
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
