import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Returns release sections in file order: { version, body }.
// Fenced examples are ignored so documentation cannot add phantom releases.
export function changelogSections(changelog) {
  const text = changelog.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, (block) =>
    block.replace(/[^\n]/g, " "),
  );
  const headings = [...text.matchAll(/^## (.+)$/gm)];
  return headings.map((match, index) => ({
    version: /^(Unreleased|\S+)/.exec(match[1])[1],
    body: changelog.slice(
      match.index + match[0].length,
      headings[index + 1]?.index ?? changelog.length,
    ),
  }));
}

export function checkTemplateVersion(template, changelog) {
  const failures = [];
  if (!template || typeof template.version !== "string")
    return ["template.json must define a version."];
  if (!semver.test(template.version))
    failures.push("template.json version must be MAJOR.MINOR.PATCH.");
  const sections = changelogSections(changelog);
  const seen = new Set();
  for (const { version } of sections) {
    if (seen.has(version))
      failures.push(`CHANGELOG.md has more than one ${version} section.`);
    seen.add(version);
  }
  if (!sections.some((section) => section.version === template.version))
    failures.push(`CHANGELOG.md has no section for ${template.version}.`);
  for (const { version, body } of sections) {
    if (version !== "Unreleased" && !semver.test(version))
      failures.push(`CHANGELOG.md section "${version}" is not a version.`);
    for (const heading of ["Changes", "Upgrade notes"])
      if (!new RegExp(`^### ${heading}$`, "m").test(body))
        failures.push(`CHANGELOG.md ${version} lacks "${heading}".`);
  }
  return failures;
}

export function validTemplateVersion(version) {
  return typeof version === "string" && semver.test(version);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = checkTemplateVersion(
    JSON.parse(readFileSync("template.json", "utf8")),
    readFileSync("CHANGELOG.md", "utf8"),
  );
  for (const failure of failures) console.error(failure);
  if (failures.length) process.exitCode = 1;
  else console.log("Template version and changelog are consistent.");
}
