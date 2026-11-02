import assert from "node:assert/strict";
import test from "node:test";
import {
  checkTemplateVersion,
  validTemplateVersion,
} from "../scripts/template-version.mjs";

const section = (version: string) =>
  `## ${version}\n\n### Changes\n\n- x\n\n### Upgrade notes\n\nNone.\n\n`;

test("a released version needs a complete changelog section", () => {
  assert.deepEqual(
    checkTemplateVersion(
      { version: "1.2.0" },
      `# Log\n\n${section("Unreleased")}${section("1.2.0 — 2026-11-02")}`,
    ),
    [],
  );
  assert.deepEqual(
    checkTemplateVersion({ version: "1.3.0" }, section("1.2.0")),
    ["CHANGELOG.md has no section for 1.3.0."],
  );
});

test("sections without upgrade notes or with invalid versions are reported", () => {
  assert.deepEqual(
    checkTemplateVersion(
      { version: "1.0.0" },
      "## 1.0.0\n\n### Changes\n\n- x\n\n## v2\n\n### Changes\n\n### Upgrade notes\n",
    ),
    [
      'CHANGELOG.md 1.0.0 lacks "Upgrade notes".',
      'CHANGELOG.md section "v2" is not a version.',
    ],
  );
  assert.deepEqual(checkTemplateVersion({ version: "1.0" }, section("1.0")), [
    "template.json version must be MAJOR.MINOR.PATCH.",
    'CHANGELOG.md section "1.0" is not a version.',
  ]);
});

test("missing versions, duplicates, fenced examples and CRLF are handled", () => {
  assert.deepEqual(checkTemplateVersion({}, section("1.0.0")), [
    "template.json must define a version.",
  ]);
  assert.deepEqual(
    checkTemplateVersion(
      { version: "1.0.0" },
      section("1.0.0") + section("1.0.0"),
    ),
    ["CHANGELOG.md has more than one 1.0.0 section."],
  );
  assert.deepEqual(
    checkTemplateVersion(
      { version: "1.0.0" },
      section("1.0.0") + "```md\n## example\n```\n",
    ),
    [],
  );
  assert.deepEqual(
    checkTemplateVersion(
      { version: "1.0.0" },
      section("1.0.0").replaceAll("\n", "\r\n"),
    ),
    [],
  );
  assert.equal(validTemplateVersion("1.0.0"), true);
  assert.equal(validTemplateVersion("01.2.3"), false);
});
