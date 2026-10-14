import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { MongoClient } from "mongodb";
import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
export async function browserFixture(env) {
  Object.assign(process.env, env);
  const auth = getAuth(
    initializeApp({ projectId: "demo-unibase" }, `browser-${randomUUID()}`),
  );
  const user = await auth.createUser({
    email: `${randomUUID()}@example.test`,
    emailVerified: true,
    password: "local-fixture-password",
  });
  const signed = await fetch(
    `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
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
      description: "Synthetic local workflow",
      order: 0,
      enabled: true,
      keyEnv: "DIFY_KEY_FIXTURE",
      pricing: null,
      recovery: null,
      responseMode: "raw-v1",
      inputs: [],
    };
    const { personaCompletionSchema } =
      await import("../../src/lib/contracts/personas.ts");
    await db.collection("personaCompletionSettings").insertOne({
      _id: "shared",
      revision: 1,
      settings: personaCompletionSchema.parse({
        enabled: true,
        model: "fixture",
      }),
    });
    const { seedPersonas } =
      await import("../../src/lib/server/runs/personas.ts");
    await seedPersonas(db);
    await db.collection("personas").updateOne(
      { name: "Parent" },
      {
        $set: { enabled: true, maxCalls: 2 },
      },
    );
    const sample = {
      ...baseDefinition,
      id: "fixture-artifact",
      name: "Saved artifact fixture",
      description: "Local sample with owned draft and image",
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
  if (process.argv.includes("--raw-responses")) {
    const { createAiJob, aiJobs } =
      await import("../../src/lib/server/ai/jobs.ts");
    const { readSettings } = await import("../../src/lib/server/settings.ts");
    const { processOneAiJob } =
      await import("../../src/lib/server/ai/worker.ts");
    const { providerForRun } =
      await import("../../src/lib/server/runs/provider.ts");
    const definition = {
      id: "raw-ui",
      name: "Raw UI fixture",
      description: "",
      order: 0,
      enabled: true,
      keyEnv: "DIFY_KEY_FIXTURE",
      pricing: null,
      recovery: null,
      responseMode: "raw-v1",
      inputs: [],
    };
    const settings = (await readSettings(db)).settings;
    const runs = [];
    for (let index = 0; index < 2; index++) {
      const id = randomUUID().replaceAll("-", "").repeat(2);
      const job = await createAiJob(
        db,
        { uid: user.uid, authTime: Math.floor(Date.now() / 1000) },
        randomUUID(),
        {
          capability: "orchestrator",
          capabilityVersion: "1",
          inputs: { prompt: "decision" },
          binding: {
            name: definition.id,
            revision: "1",
            kind: "workflow",
            mode: "fake",
            fingerprint: "fixture",
          },
          source: null,
          credits: 1,
          pricing: { mode: "fixed", credits: 1 },
          run: {
            ...settings.runs,
            logicalId: id,
            attempt: 1,
            predecessorId: null,
            orchestrator: definition,
            configurationRevision: 1,
            settingsRevision: 0,
          },
        },
      );
      await processOneAiJob(db, {
        provider: (job) => providerForRun(job, db),
        authorize: async () => true,
        validateOutput: () => true,
      });
      const data = {
        title: "Raw review",
        explanation: "Complete and save this response.",
        fields: [
          {
            id: "text",
            label: "Review text",
            kind: "text",
            required: true,
            multiline: true,
            maxLength: 4000,
          },
          {
            id: "number",
            label: "Number",
            kind: "number",
            required: true,
            min: 0,
            max: 10,
          },
          { id: "toggle", label: "Toggle", kind: "toggle", required: true },
          {
            id: "choices",
            label: "Choices",
            kind: "choice",
            required: true,
            multiple: true,
            options: [
              { id: "a", label: "A" },
              { id: "b", label: "B" },
            ],
          },
        ],
      };
      await db.collection("runDecisions").updateOne(
        { jobId: job._id },
        {
          $set: {
            form: {
              form_content:
                "```unibase-ui\n" +
                JSON.stringify({
                  version: 1,
                  cards: [
                    {
                      id: "review",
                      content: { type: "form", version: 1, data },
                    },
                  ],
                }) +
                "\n```\n{{#$output.response#}}",
              inputs: [{ type: "paragraph", output_variable_name: "response" }],
              user_actions: [{ id: "continue", title: "Continue" }],
              resolved_default_values: {},
            },
          },
        },
      );
      await aiJobs(db).updateOne(
        { _id: job._id },
        { $set: { nextAttemptAt: new Date(Date.now() + 3600000) } },
      );
      runs.push(id);
    }
    await writeFile(
      "output/playwright/raw-ui-fixture.json",
      JSON.stringify({ runs }),
    );
  }
  await writeFile(
    "output/playwright/runs-state.json",
    JSON.stringify({
      cookies: [
        {
          name: "unibase-session",
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
