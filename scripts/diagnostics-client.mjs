// Reads one-time access details from a hidden prompt or protected file.
// Credentials never enter command arguments or diagnostic output.
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

const usage = `Usage: npm run diagnostics -- --capability <name> [--access-file <path>]
  Paste the complete access details from the Create popup at the hidden prompt.

Legacy usage: npm run diagnostics -- --grant <grant ID> --capability <name>
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
    "access-file": { type: "string" },
    help: { type: "boolean", default: false },
  },
  strict: true,
});
if (values.help || !values.capability) {
  console.error(usage);
  process.exit(values.help ? 0 : 2);
}
if (values.grant && !/^[A-Za-z0-9_-]{22}$/.test(values.grant))
  throw new Error("The grant ID is 22 base64url characters.");
let payload;
try {
  payload = JSON.parse(values.payload);
} catch {
  throw new Error("--payload must be a JSON object.");
}
if (!payload || typeof payload !== "object" || Array.isArray(payload))
  throw new Error("--payload must be a JSON object.");
async function phraseFromFile(path) {
  if (process.platform !== "win32" && ((await stat(path)).mode & 0o077) !== 0)
    throw new Error(
      "The credential file must not be readable by group or others (chmod 600).",
    );
  return (await readFile(path, "utf8")).replace(/\r?\n$/, "");
}
function phraseFromPrompt(label = "Access phrase: ") {
  if (!process.stdin.isTTY)
    throw new Error("No terminal for a hidden prompt; use --access-file.");
  return new Promise((resolve) => {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    // Suppress echo of typed characters after the prompt text.
    prompt._writeToOutput = (text) => {
      if (text.startsWith(label)) process.stderr.write(text);
    };
    prompt.question(label, (answer) => {
      prompt.close();
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}

let endpoint;
let authorization;
if (values.grant) {
  if (values["access-file"])
    throw new Error("Use either --grant or --access-file.");
  const phrase = values["phrase-file"]
    ? await phraseFromFile(values["phrase-file"])
    : await phraseFromPrompt();
  const bytes = Buffer.byteLength(phrase, "utf8");
  if (bytes < 24 || bytes > 256)
    throw new Error("The phrase must be 24 to 256 bytes.");
  endpoint = new URL(
    "/api/diagnostics",
    values.origin ?? process.env.APP_ORIGIN ?? "http://localhost:3000",
  );
  authorization = `Bearer ${values.grant}.${Buffer.from(phrase, "utf8").toString("base64url")}`;
} else {
  if (values["phrase-file"] || values.origin)
    throw new Error(
      "Paste complete access details, or use the legacy --grant options.",
    );
  const details = values["access-file"]
    ? await phraseFromFile(values["access-file"])
    : await phraseFromPrompt("Diagnostic access details: ");
  const match =
    /^Diagnostic endpoint: (\S+) \| Authorization: (Bearer [A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})$/.exec(
      details,
    );
  if (!match)
    throw new Error(
      "Invalid diagnostic access details. Copy the complete string from the popup.",
    );
  endpoint = new URL(match[1]);
  if (
    endpoint.pathname !== "/api/diagnostics" ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error("Invalid diagnostic endpoint.");
  authorization = match[2];
}
const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
if (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:"))
  throw new Error("Use HTTPS except for a local development origin.");
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    authorization,
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
