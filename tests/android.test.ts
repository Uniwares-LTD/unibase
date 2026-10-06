import assert from "node:assert/strict";
import { test } from "node:test";
import { assetLinks } from "../src/lib/config/android";
import { parseAndroidConfig } from "../scripts/android-config";
test("Digital Asset Links require a complete valid identity and never reflect invalid settings", () => {
  assert.deepEqual(assetLinks(undefined, undefined), []);
  assert.deepEqual(assetLinks("com.company.unitale", undefined), []);
  assert.throws(() => assetLinks(undefined, "AA"), /Invalid ANDROID_PACKAGE/);
  assert.throws(
    () => assetLinks("secret<script>", "token"),
    /^Error: Invalid ANDROID_PACKAGE_NAME\.$/,
  );
  const fingerprint = Array(32).fill("ab").join(":");
  const links = assetLinks(
    "com.company.unitale",
    `${fingerprint},${fingerprint}`,
  );
  assert.equal(links[0].target.package_name, "com.company.unitale");
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, [
    fingerprint.toUpperCase(),
  ]);
});
test("Android release rejects placeholders and unsafe interpolated values", () => {
  const config = {
    versionCode: 1,
    versionName: "0.1.0",
  };
  const env = {
    ANDROID_HOST: "unitale.example.invalid",
    ANDROID_PACKAGE_NAME: "invalid.example.unitale",
  };
  assert.throws(
    () => parseAndroidConfig(config, env, true),
    /production Android/,
  );
  assert.throws(() => parseAndroidConfig(config, {}), /ANDROID_HOST/);
  assert.throws(
    () =>
      parseAndroidConfig(config, { ...env, ANDROID_HOST: "example.com/path" }),
    /Invalid/,
  );
  assert.throws(
    () => parseAndroidConfig({ ...config, versionCode: 0 }, env),
    /Invalid/,
  );
  assert.equal(
    parseAndroidConfig(
      config,
      {
        ANDROID_HOST: "app.company.com",
        ANDROID_PACKAGE_NAME: "com.company.unitale",
      },
      true,
    ).host,
    "app.company.com",
  );
  assert.throws(
    () => parseAndroidConfig({ ...config, host: "hardcoded.example" }, env),
    /versionCode and versionName only/,
  );
});
