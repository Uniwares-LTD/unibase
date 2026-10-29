import type { Document } from "mongodb";
import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { AppError } from "../auth-policy";
import {
  baseSettingsSchema,
  settingsUpdateSchema,
  type BaseSettings,
} from "../contracts/settings";
import { parseConfig } from "../config/schema";
import { parseCreditConfig } from "../config/credits";
import { database } from "./mongo";
import { accessTransaction } from "./store/access";

type Record = {
  _id: string;
  revision: number;
  settings: BaseSettings;
  updatedAt: Date;
};
export function bootstrapSettings(): BaseSettings {
  const base = parseConfig(process.env);
  const credit = parseCreditConfig(
    process.env,
    base.server.environment,
    process.env.AUTH_MODE === "firebase" ? "firebase" : "emulator",
  );
  return baseSettingsSchema.parse({
    public: base.public,
    credits: { packs: credit.packs, holdMinutes: 15, promotionDays: 90 },
    runs: {
      enabled: process.env.DIFY_MODE !== "disabled" && !!process.env.DIFY_MODE,
      pricing: { mode: "fixed", credits: 1 },
      failureCharging: "success-only",
      concurrentPerAccount: 5,
      reconciliationHours: 24,
      pollSeconds: 5,
      retryBaseSeconds: 2,
      retryMaxSeconds: 300,
      uploadBytes: 20 * 1024 * 1024,
      filesPerAccount: 100,
      uploadBytesPerAccount: 100 * 1024 * 1024,
      imageBytes: 8 * 1024 * 1024,
      imagePixels: 16_000_000,
      cleanupDays: 30,
    },
  });
}
export async function readSettings(db: Db = database()) {
  const records = db.collection<Record>("baseSettings");
  const existing = await records.findOne({ _id: "base" });
  if (existing)
    return {
      revision: existing.revision,
      settings: baseSettingsSchema.parse(existing.settings),
    };
  const seed = {
    _id: "base",
    revision: 0,
    settings: bootstrapSettings(),
    updatedAt: new Date(),
  };
  await records.updateOne(
    { _id: "base" },
    { $setOnInsert: seed },
    { upsert: true },
  );
  const saved = await records.findOne({ _id: "base" });
  if (!saved)
    throw new AppError(
      "SETTINGS_UNAVAILABLE",
      "Application settings are unavailable.",
      503,
    );
  return {
    revision: saved.revision,
    settings: baseSettingsSchema.parse(saved.settings),
  };
}
export async function publicSettings() {
  try {
    const row = await database()
      .collection<Record>("baseSettings")
      .findOne({ _id: "base" });
    return row
      ? baseSettingsSchema.parse(row.settings).public
      : bootstrapSettings().public;
  } catch {
    return bootstrapSettings().public;
  }
}
export async function settingsView() {
  const { requireAdmin } = await import("./admin");
  await requireAdmin();
  const current = await readSettings();
  const history = await database()
    .collection<Record>("baseSettingsVersions")
    .find({})
    .sort({ updatedAt: -1 })
    .limit(20)
    .toArray();
  return {
    ...current,
    history: history.map((r) => ({
      revision: r.revision,
      updatedAt: r.updatedAt.toISOString(),
    })),
    configuration: {
      difyMode: process.env.DIFY_MODE ?? "disabled",
      managementConfigured: !!process.env.DIFY_MANAGEMENT_KEY,
      storage: process.env.ASSET_STORE ?? "mongo",
      payments: process.env.PAYMENTS_MODE ?? "simulation",
    },
  };
}
export async function updateSettings(input: unknown) {
  const { requireAdmin } = await import("./admin");
  const actor = await requireAdmin();
  const parsed = settingsUpdateSchema.parse(input);
  const db = database();
  // Reuse payment validation including environment restrictions and price uniqueness.
  const base = parseConfig(process.env);
  parseCreditConfig(
    {
      ...process.env,
      CREDIT_PACKS_JSON: JSON.stringify(parsed.settings.credits.packs),
    },
    base.server.environment,
    process.env.AUTH_MODE === "firebase" ? "firebase" : "emulator",
  );
  await accessTransaction(
    db,
    actor.uid,
    async (session) => {
      const previous = await db
        .collection<Record>("baseSettings")
        .findOneAndUpdate(
          { _id: "base", revision: parsed.revision },
          {
            $set: { settings: parsed.settings, updatedAt: new Date() },
            $inc: { revision: 1 },
          },
          { session, returnDocument: "before" },
        );
      if (!previous)
        throw new AppError(
          "SETTINGS_CONFLICT",
          "Settings changed. Reload before saving.",
          409,
        );
      await db
        .collection<Record>("baseSettingsVersions")
        .insertOne({ ...previous, _id: randomUUID() }, { session });
      await db.collection<Document & { _id: string }>("auditEvents").insertOne(
        {
          _id: randomUUID(),
          event: "base-settings",
          actorUid: actor.uid,
          targetUid: actor.uid,
          reason: parsed.reason,
          timestamp: new Date(),
        },
        { session },
      );
    },
    actor.auth_time,
  );
  return readSettings(db);
}
