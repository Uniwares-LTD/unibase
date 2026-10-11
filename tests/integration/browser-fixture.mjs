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
  console.log(
    "Owned browser fixture ready at http://127.0.0.1:3101. Press Enter to stop.",
  );
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("data", resolve));
  process.stdin.pause();
  worker.kill();
  await client.close();
  await auth.deleteUser(user.uid);
}
