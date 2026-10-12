import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import type { Db, ClientSession } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { parseMcpConfig } from "@/lib/config/mcp";
import { aiJobs, type AiJob } from "../ai/jobs";
import { authorizeWorkerAccount } from "../worker-authorization";
import { accountAccess, accessPermitsSession } from "../store/access";

type Capability = {
  _id: string;
  jobId: string;
  uid: string;
  clientId: string;
  operations: string[];
  expiresAt: Date;
  ciphertext: string;
  iv: string;
  tag: string;
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function key() {
  const explicit = process.env.DIFY_CREDENTIAL_ENCRYPTION_KEY;
  if (explicit && !/^[a-fA-F0-9]{64}$/.test(explicit))
    throw new AppError(
      "CAPABILITY_CONFIGURATION",
      "Invalid encryption configuration.",
      503,
    );
  const secret = explicit
    ? Buffer.from(explicit, "hex")
    : process.env.DIFY_MANAGEMENT_KEY;
  if (!secret)
    throw new AppError(
      "CAPABILITY_CONFIGURATION",
      "Configure private capability encryption.",
      503,
    );
  return Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      process.env.APP_ORIGIN ?? "local",
      "unibase:run-capabilities:v1",
      32,
    ),
  );
}
function decrypt(record: Capability) {
  try {
    const d = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(record.iv, "base64"),
    );
    d.setAAD(Buffer.from(record.jobId));
    d.setAuthTag(Buffer.from(record.tag, "base64"));
    return Buffer.concat([
      d.update(Buffer.from(record.ciphertext, "base64")),
      d.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError(
      "CAPABILITY_CONFIGURATION",
      "The saved Run context cannot be decrypted. Restore its encryption configuration.",
      503,
    );
  }
}
export async function capabilityForRun(db: Db, job: AiJob) {
  const records = db.collection<Capability>("runCapabilities");
  const existing = await records.findOne({ jobId: job._id });
  if (existing) return decrypt(existing);
  const operations = job.run?.orchestrator.privateTools ?? [];
  const config = parseMcpConfig(
    process.env,
    process.env.APP_ORIGIN ?? "http://localhost:3000",
  );
  const clientId = process.env.RUN_MCP_CLIENT_ID ?? "dify";
  const client = config.enabled
    ? config.clients.find((c) => c.id === clientId)
    : undefined;
  if (!client || !operations.length)
    throw new AppError(
      "CAPABILITY_CONFIGURATION",
      "Configure the Run MCP client and private tools.",
      503,
    );
  const { privateToolPermissions } = await import("../mcp/private-tools");
  if (
    operations.some(
      (op) => !client.permissions.includes(privateToolPermissions[op]),
    )
  )
    throw new AppError(
      "CAPABILITY_CONFIGURATION",
      "Grant the Run MCP client's required permissions.",
      503,
    );
  const token = randomBytes(32).toString("base64url");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(job._id));
  const ciphertext = Buffer.concat([
    c.update(token, "utf8"),
    c.final(),
  ]).toString("base64");
  await records.updateOne(
    { jobId: job._id },
    {
      $setOnInsert: {
        _id: hash(token),
        jobId: job._id,
        uid: job.uid,
        clientId,
        operations,
        expiresAt: job.reviewAfter,
        ciphertext,
        iv: iv.toString("base64"),
        tag: c.getAuthTag().toString("base64"),
      },
    },
    { upsert: true },
  );
  return decrypt((await records.findOne({ jobId: job._id }))!);
}
export async function authorizedRun(
  db: Db,
  token: string,
  clientId: string,
  operation: string,
  session?: ClientSession,
  authorize = authorizeWorkerAccount,
) {
  const capability = /^[A-Za-z0-9_-]{43}$/.test(token)
    ? await db.collection<Capability>("runCapabilities").findOne(
        {
          _id: hash(token),
          clientId,
          operations: operation,
          expiresAt: { $gt: new Date() },
        },
        { session },
      )
    : null;
  const job = capability
    ? await aiJobs(db).findOne(
        {
          _id: capability.jobId,
          uid: capability.uid,
          cancelRequested: false,
          status: { $in: ["dispatching", "running", "paused", "unknown"] },
        },
        { session },
      )
    : null;
  if (
    !job ||
    (job.execution && !["running", "paused"].includes(job.execution.status)) ||
    !(await authorize(job.uid, job.authTime)) ||
    !accessPermitsSession(
      await accountAccess(db, job.uid, session),
      job.authTime,
    )
  )
    throw new AppError(
      "RUN_ACCESS_DENIED",
      "Run operation is unavailable.",
      403,
    );
  return job;
}
