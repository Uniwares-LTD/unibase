import fs from "node:fs";
import path from "node:path";
const root = process.cwd(),
  scripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts;
const files = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CHANGELOG.md",
  ...[
    "docs",
    ".agents",
    ".claude",
    "dify",
    "src/lib/server/runs/templates",
    "src/samples",
  ].flatMap((dir) =>
    fs
      .readdirSync(dir, { recursive: true })
      .filter((file) => file.endsWith(".md"))
      .map((file) => path.join(dir, file)),
  ),
];
const failures = [];
function prose(text) {
  return text
    .replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "")
    .replace(/`[^`\n]+`/g, "");
}
function anchors(text) {
  const seen = new Map();
  return new Set(
    [...text.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)].map((match) => {
      const slug = match[1]
        .toLowerCase()
        .replace(/<[^>]+>/g, "")
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-");
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      return slug + (count ? `-${count}` : "");
    }),
  );
}
for (const file of files) {
  const raw = fs.readFileSync(file, "utf8"),
    text = prose(raw);
  for (const match of text.matchAll(
    /\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const link = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z]+:|\/\/)/i.test(link) || link.includes("${")) continue;
    const [name, anchor] = link.split("#");
    let target;
    try {
      target = name
        ? path.resolve(path.dirname(file), decodeURIComponent(name))
        : path.resolve(file);
    } catch {
      failures.push(`${file}: invalid link ${link}`);
      continue;
    }
    if (!target.startsWith(root + path.sep) && target !== root) {
      continue;
    } // Imported references may intentionally point into their source repository.
    if (!fs.existsSync(target)) {
      failures.push(`${file}: missing ${link}`);
      continue;
    }
    if (
      anchor &&
      target.endsWith(".md") &&
      !anchors(prose(fs.readFileSync(target, "utf8"))).has(
        decodeURIComponent(anchor),
      )
    )
      failures.push(`${file}: missing anchor ${link}`);
  }
  if (!file.startsWith(".agents" + path.sep + "skills"))
    for (const match of raw.matchAll(/npm(?:\.cmd)? run ([\w:-]+)/g))
      if (!scripts[match[1]])
        failures.push(`${file}: unknown command ${match[1]}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Verified local links, anchors and repository commands in ${files.length} documents.`,
  );
