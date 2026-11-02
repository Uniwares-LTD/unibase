import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import sharp from "sharp";
import { buildAssetVariants } from "../../src/lib/server/runs/asset-variants";
import { scheduleAssetDeletion } from "../../src/lib/server/runs/assets";
import {
  ensureAssetVariants,
  readRunAsset,
  runAssetDigest,
  type RunAsset,
} from "../../src/lib/server/runs/media";
import { coreMigrations } from "../../src/lib/server/core-migrations";

// A noisy photo-like PNG compresses poorly, like generated result images.
async function photo(width: number, height: number) {
  return sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();
}
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function asset(id: string, uid: string, png: Buffer): RunAsset {
  return {
    _id: id,
    uid,
    logicalId: "logical",
    jobId: "job",
    name: "panel",
    mime: "image/png",
    bytes: png.length,
    digest: digest(png),
    base64: png.toString("base64"),
    status: "ready",
    createdAt: new Date(),
  };
}

test("variants are bounded WebP renditions smaller than the original", async () => {
  const png = await photo(1600, 1200);
  const variants = await buildAssetVariants(png);
  for (const [size, limit] of [
    ["thumb", 400],
    ["preview", 1280],
  ] as const) {
    const variant = variants[size]!;
    assert.equal(variant.mime, "image/webp");
    assert.ok(variant.width <= limit && variant.height <= limit);
    assert.ok(variant.bytes < png.length);
    const bytes = Buffer.from(variant.base64, "base64");
    assert.equal(bytes.length, variant.bytes);
    assert.equal(digest(bytes), variant.digest);
    assert.equal((await sharp(bytes).metadata()).format, "webp");
  }
  // Small images are never enlarged.
  const small = await buildAssetVariants(await photo(200, 100));
  assert.equal(small.thumb?.width, 200);
  assert.equal(small.thumb?.height, 100);
});

test("asset reads serve variants lazily, revalidate by digest and stay owned", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri()),
    db = client.db("asset-variants");
  try {
    const png = await photo(900, 600);
    const legacy = asset("asset-1", "owner", png);
    await db.collection<RunAsset>("runAssets").insertOne(legacy);

    // Before generation the variant digest is unknown; the first read creates
    // and stores the variants once.
    assert.equal(
      await runAssetDigest(db, "owner", "asset-1", "thumb"),
      undefined,
    );
    const thumb = await readRunAsset(db, "owner", "asset-1", "thumb");
    assert.equal(thumb.mime, "image/webp");
    assert.ok(thumb.bytes.length < png.length);
    const stored = await db
      .collection<RunAsset>("runAssets")
      .findOne({ _id: "asset-1" });
    assert.equal(stored?.variants?.thumb?.digest, thumb.digest);
    assert.equal(
      await runAssetDigest(db, "owner", "asset-1", "thumb"),
      thumb.digest,
    );
    assert.equal(
      await runAssetDigest(db, "owner", "asset-1", "original"),
      legacy.digest,
    );

    const original = await readRunAsset(db, "owner", "asset-1");
    assert.equal(original.mime, "image/png");
    assert.ok(original.bytes.equals(png));

    // Ownership applies to every size.
    for (const size of ["thumb", "preview", "original"] as const)
      await assert.rejects(readRunAsset(db, "intruder", "asset-1", size), {
        code: "ASSET_NOT_FOUND",
      });

    // A damaged stored variant falls back to the verified original.
    await db
      .collection<RunAsset>("runAssets")
      .updateOne(
        { _id: "asset-1" },
        { $set: { "variants.preview.digest": "0" } },
      );
    assert.equal(
      (await readRunAsset(db, "owner", "asset-1", "preview")).mime,
      "image/png",
    );

    // The backfill migration covers saved product copies too.
    await db.collection("productAssets").insertOne({
      ...asset("asset-2", "owner", png),
      state: "ready",
      references: ["artifact-1"],
      fence: 0,
    } as never);
    const migration = coreMigrations.find(
      (entry) => entry.id === "runs:0002-asset-variants",
    )!;
    await migration.run(db);
    await migration.run(db);
    const copy = await db
      .collection<RunAsset>("productAssets")
      .findOne({ _id: "asset-2" });
    assert.ok(copy?.variants?.preview);

    // Non-ready records are skipped by the backfill and by lazy generation.
    await db.collection("productAssets").insertOne({
      ...asset("asset-3", "owner", png),
      state: "deleted",
      references: [],
      fence: 1,
    } as never);
    await migration.run(db);
    await ensureAssetVariants(
      db,
      "productAssets",
      asset("asset-3", "owner", png),
    );
    assert.equal(
      (
        await db
          .collection<RunAsset>("productAssets")
          .findOne({ _id: "asset-3" })
      )?.variants,
      undefined,
    );

    // Deleting a saved asset removes its variants with the payload.
    await db
      .collection<RunAsset>("productAssets")
      .updateOne({ _id: "asset-2" }, { $set: { references: [] } as never });
    const deletion = client.startSession();
    try {
      await deletion.withTransaction(async () => {
        const saved = await db
          .collection<RunAsset>("productAssets")
          .findOne({ _id: "asset-2" });
        await scheduleAssetDeletion(db, saved as never, deletion);
      });
    } finally {
      await deletion.endSession();
    }
    const removed = await db
      .collection<RunAsset>("productAssets")
      .findOne({ _id: "asset-2" });
    assert.equal(removed?.variants, undefined);
    assert.equal(removed?.base64, undefined);

    // An undecodable image records no variants once and serves its original.
    const junk = randomBytes(4096);
    await db.collection<RunAsset>("runAssets").insertOne({
      ...asset("asset-4", "owner", junk),
    });
    const fallback = await readRunAsset(db, "owner", "asset-4", "thumb");
    assert.equal(fallback.mime, "image/png");
    assert.ok(fallback.bytes.equals(junk));
    assert.deepEqual(
      (await db.collection<RunAsset>("runAssets").findOne({ _id: "asset-4" }))
        ?.variants,
      {},
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
