import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { MongoClient } from "mongodb";
import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
export async function browserFixture(env) {
  Object.assign(process.env, env);
  const auth = getAuth(
    initializeApp({ projectId: "demo-unitale" }, `browser-${randomUUID()}`),
  );
  const user = await auth.createUser({
    email: `${randomUUID()}@example.test`,
    emailVerified: true,
    password: "local-fixture-password",
  });
  const signed = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        password: "local-fixture-password",
        returnSecureToken: true,
      }),
    },
  );
  const { idToken } = await signed.json();
  const session = await auth.createSessionCookie(idToken, {
    expiresIn: 3600000,
  });
  const client = new MongoClient(env.MONGODB_URI);
  const db = client.db(env.MONGODB_DATABASE);
  await db.collection("accountAccess").updateOne(
    { _id: user.uid },
    {
      $set: {
        role: "admin",
        status: "active",
        notBefore: 0,
        revision: 0,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  const { grantCredits } =
    await import("../../src/lib/server/store/credits.ts");
  await grantCredits(db, user.uid, "browser-seed", {
    amount: 30,
    source: "purchase",
    reference: user.uid,
  });
  if (process.argv.includes("--personas")) {
    const baseDefinition = {
      id: "fixture-responder",
      name: "Fixture responder",
      description: "Synthetic local responder",
      order: 0,
      enabled: true,
      keyEnv: "DIFY_KEY_FIXTURE",
      pricing: null,
      recovery: null,
      purpose: "responder",
      inputs: ["persona", "question", "context"].map((name) => ({
        name,
        label: name,
        kind: "paragraph",
        required: true,
        options: [],
      })),
    };
    await db.collection("orchestrators").insertOne({
      _id: baseDefinition.id,
      revision: 1,
      definition: baseDefinition,
      validated: true,
      updatedAt: new Date(),
    });
    const { seedPersonas } =
      await import("../../src/lib/server/runs/personas.ts");
    await seedPersonas(db);
    await db.collection("personas").updateOne(
      { name: "Parent" },
      {
        $set: { enabled: true, responderId: baseDefinition.id, maxCalls: 2 },
      },
    );
    const sample = {
      ...baseDefinition,
      id: "fixture-artifact",
      name: "Saved artifact fixture",
      description: "Local sample with owned draft and image",
      purpose: "run",
      inputs: [],
      contextInput: true,
      privateTools: [
        "read_artifact_v1",
        "save_artifact_draft_v1",
        "approve_artifact_v1",
      ],
    };
    await db.collection("orchestrators").insertOne({
      _id: sample.id,
      revision: 1,
      definition: sample,
      validated: true,
      updatedAt: new Date(),
    });
    await db.collection("artifacts").createIndex({ id: 1 }, { unique: true });
    await db
      .collection("runCapabilities")
      .createIndex({ jobId: 1 }, { unique: true });
    env.MCP_ENABLED = "true";
    env.MCP_TOKEN_FIXTURE = "b".repeat(43);
    env.MCP_CLIENTS_JSON = JSON.stringify([
      {
        id: "dify",
        tokenEnv: "MCP_TOKEN_FIXTURE",
        permissions: ["run:read", "artifact:read", "artifact:write"],
      },
    ]);
    env.DIFY_CREDENTIAL_ENCRYPTION_KEY = "cd".repeat(32);
  }
  if (process.argv.includes("--pagination")) {
    const createdAt = new Date();
    await db.collection("artifacts").insertMany(
      Array.from({ length: 60 }, (_, i) => ({
        id: randomUUID(),
        uid: user.uid,
        title: "Pagination artifact " + String(i).padStart(3, "0"),
        revision: 0,
        approvedRevision: null,
        assets: [],
        createdAt,
      })),
    );
  }
  await mkdir("output/playwright", { recursive: true });
  await writeFile(
    "output/playwright/runs-state.json",
    JSON.stringify({
      cookies: [
        {
          name: "unitale-session",
          value: session,
          domain: "127.0.0.1",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 3600,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
  );
  const worker = spawn(process.execPath, ["dist/ai-worker.cjs"], {
    env,
    windowsHide: true,
    stdio: "inherit",
  });
  const maintenance = spawn(process.execPath, ["dist/payment-worker.cjs"], {
    env,
    windowsHide: true,
    stdio: "inherit",
  });
  console.log(
    "Owned browser fixture ready at http://127.0.0.1:3101. Press Enter to stop.",
  );
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("data", resolve));
  process.stdin.pause();
  worker.kill();
  maintenance.kill();
  await client.close();
  await auth.deleteUser(user.uid);
}
