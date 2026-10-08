import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseAssetConfig,
  assetByteLimit,
  imageByteLimit,
} from "../src/lib/config/assets";
test("private asset config defaults to Mongo and validates explicit server-only S3 settings", () => {
  assert.deepEqual(parseAssetConfig({}), { mode: "mongo" });
  assert.equal(assetByteLimit(parseAssetConfig({})), 8 * 1024 * 1024);
  const env = {
    APP_ENV: "production",
    ASSET_STORE: "s3",
    ASSET_S3_ENDPOINT: "https://objects.example.test",
    ASSET_S3_REGION: "us-east-1",
    ASSET_S3_BUCKET: "private-assets",
    ASSET_S3_ACCESS_KEY_ID: "fixture",
    ASSET_S3_SECRET_ACCESS_KEY: "secret-fixture",
  };
  const config = parseAssetConfig(env);
  assert.equal(assetByteLimit(config), 64 * 1024 * 1024);
  assert.equal(imageByteLimit(config), 20 * 1024 * 1024);
  for (const override of [
    { ASSET_STORE: "public" },
    { ASSET_S3_ENDPOINT: "http://objects.example.test" },
    { ASSET_S3_ENDPOINT: "https://name:secret-fixture@objects.example.test" },
    { ASSET_S3_ENDPOINT: "https://objects.example.test/path" },
    { ASSET_S3_ENDPOINT: "https://objects.example.test?key=secret-fixture" },
    { ASSET_S3_PREFIX: "../other" },
    { ASSET_S3_BUCKET: "bad..bucket" },
    { ASSET_S3_FORCE_PATH_STYLE: "yes" },
    { ASSET_S3_SECRET_ACCESS_KEY: "" },
  ]) {
    assert.throws(
      () => parseAssetConfig({ ...env, ...override }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes("secret-fixture"));
        return true;
      },
    );
  }
  assert.equal(
    parseAssetConfig({
      ...env,
      APP_ENV: "local",
      ASSET_S3_ENDPOINT: "http://127.0.0.1:9000",
    }).mode,
    "s3",
  );
  assert.throws(() =>
    parseAssetConfig({ ...env, ASSET_S3_ENDPOINT: "http://127.0.0.1:9000" }),
  );
});
