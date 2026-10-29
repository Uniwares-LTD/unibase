// Operator helper for POST /api/diagnostics. Reads the access phrase from a
// hidden prompt or a protected file; never prints, logs or saves the phrase.
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

const usage = `Usage: npm run diagnostics -- --grant <grant ID> --capability <name>
  [--payload '<JSON object>'] [--origin <https://host>] [--phrase-file <path>]

Without --phrase-file the phrase is read from a hidden prompt. The origin
defaults to APP_ORIGIN, then http://localhost:3000.`;

const { values } = parseArgs({
  options: {
    grant: { type: "string" },
    capability: { type: "string" },
    payload: { type: "string", default: "{}" },
    origin: { type: "string" },
    "phrase-file": { type: "string" },
    help: { type: "boolean", default: false },
  },
  strict: true,
});
if (values.help || !values.grant || !values.capability) {
  console.error(usage);
  process.exit(values.help ? 0 : 2);
}
if (!/^[A-Za-z0-9_-]{22}$/.test(values.grant))
  throw new Error("The grant ID is 22 base64url characters.");
let payload;
try {
  payload = JSON.parse(values.payload);
} catch {
  throw new Error("--payload must be a JSON object.");
}
if (!payload || typeof payload !== "object" || Array.isArray(payload))
  throw new Error("--payload must be a JSON object.");
const origin = new URL(
  values.origin ?? process.env.APP_ORIGIN ?? "http://localhost:3000",
);
const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
if (origin.protocol !== "https:" && !(local && origin.protocol === "http:"))
  throw new Error("Use HTTPS except for a local development origin.");

async function phraseFromFile(path) {
  if (process.platform !== "win32" && ((await stat(path)).mode & 0o077) !== 0)
    throw new Error(
      "The phrase file must not be readable by group or others (chmod 600).",
    );
  return (await readFile(path, "utf8")).replace(/\r?\n$/, "");
}
function phraseFromPrompt() {
  if (!process.stdin.isTTY)
    throw new Error("No terminal for a hidden prompt; use --phrase-file.");
  return new Promise((resolve) => {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    // Suppress echo of typed characters after the prompt text.
    prompt._writeToOutput = (text) => {
      if (text.startsWith("Access phrase: ")) process.stderr.write(text);
    };
    prompt.question("Access phrase: ", (answer) => {
      prompt.close();
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}

const phrase = values["phrase-file"]
  ? await phraseFromFile(values["phrase-file"])
  : await phraseFromPrompt();
const bytes = Buffer.byteLength(phrase, "utf8");
if (bytes < 24 || bytes > 256)
  throw new Error("The phrase must be 24 to 256 bytes.");
const response = await fetch(new URL("/api/diagnostics", origin), {
  method: "POST",
  headers: {
    authorization: `Bearer ${values.grant}.${Buffer.from(phrase, "utf8").toString("base64url")}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ capability: values.capability, payload }),
  signal: AbortSignal.timeout(20000),
});
const text = await response.text();
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text.slice(0, 2000));
}
if (!response.ok) process.exitCode = 1;
