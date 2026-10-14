import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStylePreference, resolveStyle } from "../src/lib/appearance";
import { resolvePageCover } from "../src/lib/page-cover";
import {
  accountDetailsUpdateSchema,
  appearanceUpdateSchema,
  profileSchema,
  profileUpdateSchema,
} from "../src/lib/contracts/profile";

test("appearance defaults and untrusted cookies resolve only to supported styles", () => {
  for (const value of [undefined, "", "unknown", "<script>", null])
    assert.equal(resolveStyle(parseStylePreference(value), "glass"), "glass");
  assert.equal(
    resolveStyle(parseStylePreference("classic"), "glass"),
    "classic",
  );
  assert.equal(resolveStyle(parseStylePreference("glass"), "classic"), "glass");
  assert.equal(
    resolveStyle(parseStylePreference("soft-blue"), "classic"),
    "soft-blue",
  );
});

test("older profiles inherit the app default and older mutations do not reset style", () => {
  const legacy = {
    uid: "owned",
    email: "owned@example.test",
    displayName: "Owned",
    theme: "dark",
    updatedAt: "2026-10-05T00:00:00.000Z",
  };
  assert.equal(profileSchema.parse(legacy).style, "default");
  const oldUpdate = profileUpdateSchema.parse({
    displayName: "Owned",
    theme: "light",
  });
  assert.ok(!("style" in oldUpdate));
  assert.equal(
    profileSchema.parse({ ...legacy, style: "glass" }).style,
    "glass",
  );
  assert.equal(
    profileUpdateSchema.parse({ ...oldUpdate, style: "soft-blue" }).style,
    "soft-blue",
  );
  assert.equal(
    profileUpdateSchema.safeParse({ ...oldUpdate, style: "unknown" }).success,
    false,
  );
});

test("page covers accept image URLs and reject unsafe or mixed-content metadata", () => {
  const base = "https://unibase.example/stories/one";
  assert.equal(
    resolvePageCover("/covers/one.jpg", base),
    "https://unibase.example/covers/one.jpg",
  );
  assert.equal(
    resolvePageCover("https://cdn.example/cover.jpg", base),
    "https://cdn.example/cover.jpg",
  );
  assert.equal(
    resolvePageCover("/cover.jpg", "http://localhost:3000"),
    "http://localhost:3000/cover.jpg",
  );
  for (const value of [
    null,
    "",
    "  ",
    "javascript:alert(1)",
    "data:image/png;base64,abc",
    "https://user:secret@example.com/cover.jpg",
    "http://example.com/cover.jpg",
    "https://[",
  ]) {
    assert.equal(resolvePageCover(value, base), null);
  }
});

test("account and appearance updates reject fields from the other section", () => {
  assert.deepEqual(
    accountDetailsUpdateSchema.parse({ displayName: " New name " }),
    { displayName: "New name" },
  );
  for (const extra of [
    { theme: "dark" },
    { style: "glass" },
    { email: "forged@example.test" },
    { uid: "other" },
  ]) {
    assert.equal(
      accountDetailsUpdateSchema.safeParse({ displayName: "Name", ...extra })
        .success,
      false,
    );
  }
  assert.deepEqual(
    appearanceUpdateSchema.parse({ theme: "dark", style: "glass" }),
    { theme: "dark", style: "glass" },
  );
  for (const input of [
    { theme: "dark" },
    { theme: "invalid", style: "glass" },
    { theme: "dark", style: "invalid" },
    { theme: "dark", style: "glass", displayName: "Name" },
  ]) {
    assert.equal(appearanceUpdateSchema.safeParse(input).success, false);
  }
});
