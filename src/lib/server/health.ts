import "server-only";
import { readFile } from "node:fs/promises";
import { createPrivateKey } from "node:crypto";
import { probeReadiness } from "../readiness";
import { getAuthConfig } from "./auth-config";
import { adminAuth } from "./firebase";
import { database } from "./mongo";

async function credentialsAvailable(signal: AbortSignal) {
  const config = getAuthConfig();
  if (config.server.mode === "emulator") {
    const response = await fetch(`http://${config.server.emulatorHost}/`, {
      signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Auth unavailable");
    return;
  }
  // VPS deployment uses a mounted service-account file, not ambient credentials.
  // Check availability and project ownership without issuing OAuth requests on
  // every public probe. Real provider operations are exercised in acceptance.
  const filename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!filename) throw new Error("Credentials unavailable");
  const credential = JSON.parse(
    await readFile(filename, { signal, encoding: "utf8" }),
  );
  if (
    credential.type !== "service_account" ||
    credential.project_id !== config.public.projectId ||
    typeof credential.client_email !== "string" ||
    !credential.client_email.endsWith(".gserviceaccount.com") ||
    typeof credential.private_key !== "string"
  )
    throw new Error("Credentials unavailable");
  createPrivateKey(credential.private_key);
  adminAuth();
}

export async function isReady() {
  return probeReadiness([
    credentialsAvailable,
    async () => {
      await database().command({ ping: 1 }, { timeoutMS: 4000 });
    },
  ]);
}

export function releaseCommit() {
  const commit = process.env.RELEASE_COMMIT;
  return commit && /^[a-f0-9]{40}$/.test(commit) ? commit : undefined;
}
