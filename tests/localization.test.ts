import assert from "node:assert/strict";
import { test } from "node:test";
import en from "../messages/en.json";
import ar from "../messages/ar.json";
import {
  parse,
  TYPE,
  type MessageFormatElement,
} from "@formatjs/icu-messageformat-parser";
import {
  resolveLocale,
  localizationSchema,
  timeZoneSchema,
} from "../src/lib/locale";
import {
  profileSchema,
  appearanceUpdateSchema,
  accountDetailsUpdateSchema,
} from "../src/lib/contracts/profile";
test("locale precedence and time zones reject invalid preferences without changing independent profile fields", () => {
  assert.equal(resolveLocale("ar", "en", "en"), "ar");
  assert.equal(resolveLocale(undefined, "ar", "en"), "ar");
  assert.equal(
    resolveLocale("invalid", undefined, "fr;q=1,ar-SA;q=0.8,en;q=0.5"),
    "ar",
  );
  assert.equal(resolveLocale(undefined, undefined, "ar;q=0,en;q=0.2"), "en");
  assert.equal(resolveLocale(undefined, undefined, "ar;q=99"), "en");
  assert.equal(timeZoneSchema.safeParse("Asia/Tehran").success, true);
  assert.equal(timeZoneSchema.safeParse("Bad/Zone").success, false);
  assert.equal(
    localizationSchema.safeParse({
      locale: "ar",
      timeZone: "UTC",
      theme: "dark",
    }).success,
    false,
  );
  assert.equal(
    appearanceUpdateSchema.safeParse({
      theme: "dark",
      style: "glass",
      locale: "ar",
    }).success,
    false,
  );
  assert.equal(
    accountDetailsUpdateSchema.safeParse({ displayName: "A", timeZone: "UTC" })
      .success,
    false,
  );
  const profile = profileSchema.parse({
    uid: "a",
    email: "a@example.test",
    displayName: "A",
    theme: "dark",
    style: "glass",
    updatedAt: new Date().toISOString(),
  });
  assert.equal(profile.locale, "en");
  assert.equal(profile.timeZone, "UTC");
  assert.equal(profile.style, "glass");
});
// ICU argument names (not plural/select branch text); parsing also rejects malformed messages.
function argumentsOf(message: string, path: string) {
  const names = new Set<string>();
  function walk(elements: MessageFormatElement[]) {
    for (const element of elements) {
      if ("value" in element && element.type !== TYPE.literal)
        names.add(String(element.value));
      if ("options" in element)
        for (const option of Object.values(element.options)) walk(option.value);
      if ("children" in element) walk(element.children);
    }
  }
  try {
    walk(parse(message, { ignoreTag: true }));
  } catch (error) {
    assert.fail(`${path}: ${(error as Error).message}`);
  }
  return [...names].sort();
}
test("every translation has matching keys and interpolation parameters", () => {
  function check(a: unknown, b: unknown, path = "") {
    if (typeof a === "string") {
      assert.equal(typeof b, "string", path);
      assert.ok((b as string).trim(), path);
      assert.deepEqual(
        argumentsOf(a, path),
        argumentsOf(b as string, path),
        path,
      );
      return;
    }
    assert.deepEqual(
      Object.keys(a as object).sort(),
      Object.keys(b as object).sort(),
      path,
    );
    for (const key of Object.keys(a as object))
      check(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        path + "." + key,
      );
  }
  check(en, ar);
});
