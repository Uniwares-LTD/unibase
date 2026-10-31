import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  writeFile,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import { projectSchema, moduleIds } from "../src/lib/project";

type Options = {
  source: string;
  revision: string;
  destination: string;
  manifest: unknown;
  mode: "application" | "examples";
  infrastructureProfile?: unknown;
};
const excluded =
  /^(?:\.git(?:\/|$)|node_modules\/|\.next\/|\.cache\/|\.codex\/|\.aws\/|\.firebase\/|\.setup\/|output\/|dist\/|coverage\/|test-results\/|playwright-report\/|\.playwright-cli\/|android\/project\/|deploy\/config\.json$|\.env(?!\.example$)|.*(?:\/|^)(?:credentials|service-account)[^/]*\.json$)|\.(?:pem|key|keystore|jks|aab|apk|tsbuildinfo|log)$/i;
function git(source: string, args: string[], input?: string) {
  const result = spawnSync("git", ["-C", source, ...args], {
    input,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error("The reviewed Git source could not be read.");
  return result.stdout;
}
function inside(parent: string, child: string) {
  const rel = path.relative(parent, child);
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
}
async function checkedDestination(source: string, destination: string) {
  const target = path.resolve(destination);
  if (
    target === path.parse(target).root ||
    inside(source, target) ||
    inside(target, source)
  )
    throw new Error(
      "Destination must be separate from the source repository and its ancestors.",
    );
  // Existing parents must be ordinary directories, not junctions/symlinks.
  let current = target;
  while (current !== path.parse(current).root) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("Unsafe destination path.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    current = path.dirname(current);
  }
  try {
    if ((await readdir(target)).length)
      throw new Error("Destination must be empty.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}
export async function createProject(options: Options) {
  const manifest = projectSchema.parse(options.manifest);
  if (!["application", "examples"].includes(options.mode))
    throw new Error("Choose application or examples mode.");
  if (manifest.examples !== (options.mode === "examples"))
    throw new Error("Manifest example selection must match the explicit mode.");
  if (!moduleIds.every((id) => manifest.modules.includes(id)))
    throw new Error("New projects start with every reusable module enabled.");
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(options.revision))
    throw new Error("Supply the full reviewed Git commit ID.");
  const source = await realpath(options.source),
    target = await checkedDestination(source, options.destination);
  const revision = git(source, [
    "rev-parse",
    "--verify",
    `${options.revision}^{commit}`,
  ])
    .toString()
    .trim();
  const entries = git(source, ["ls-tree", "-rz", "--full-tree", revision])
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
      if (!match) throw new Error("Invalid source tree.");
      const [, mode, type, object, name] = match;
      if (
        name.includes("\\") ||
        name
          .split("/")
          .some(
            (part) =>
              !part || part === "." || part === ".." || part.includes(":"),
          ) ||
        name.startsWith("/")
      )
        throw new Error("Unsafe source path.");
      if (
        excluded.test(name) ||
        [".agents/tracking.json", ".agents/repository.md"].includes(name) ||
        /^deploy\/shared-owner\/.*\.patch$/.test(name) ||
        /(^|\/)(?:\.env(?!\.example$)[^/]*|\.npmrc|\.vscode|\.idea|secrets?|credentials?)(?:\/|$)|\.env$|(?:service[-_]?account|credentials?)[^/]*\.json$/i.test(
          name,
        )
      )
        return null;
      if (type !== "blob" || !["100644", "100755"].includes(mode))
        throw new Error("Source symlinks and submodules are not supported.");
      return { mode, object, name };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
  if (names.size !== entries.length)
    throw new Error("Source paths collide on case-insensitive filesystems.");
  for (const required of [
    "package.json",
    "package-lock.json",
    "project.config.json",
    ".env.example",
    "deploy/config.example.json",
    "scripts/i18n-assets.mjs",
    "deploy/environments/local.json",
    "deploy/environments/staging.json",
    "deploy/environments/production.json",
  ])
    if (!names.has(required))
      throw new Error(
        "The reviewed revision does not contain the reusable-project contract.",
      );
  const blobs = git(
    source,
    ["cat-file", "--batch"],
    entries.map((entry) => entry.object).join("\n") + "\n",
  );
  await mkdir(path.dirname(target), { recursive: true });
  const staging = await mkdtemp(
    path.join(path.dirname(target), `.${manifest.slug}-create-`),
  );
  // On failure retain only this newly created staging directory for inspection;
  // never recursively remove an existing user destination.
  let offset = 0;
  for (const entry of entries) {
    const end = blobs.indexOf(10, offset);
    const header = blobs.subarray(offset, end).toString();
    const match = /^[a-f0-9]+ blob (\d+)$/.exec(header);
    if (!match) throw new Error("Invalid source object.");
    const size = Number(match[1]);
    if (
      !Number.isSafeInteger(size) ||
      size > 16 * 1024 * 1024 ||
      end + size + 1 >= blobs.length
    )
      throw new Error("Source file exceeds the initializer bound.");
    const file = path.join(staging, entry.name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, blobs.subarray(end + 1, end + 1 + size), {
      flag: "wx",
    });
    if (entry.mode === "100755") await chmod(file, 0o755);
    offset = end + size + 2;
  }
  const json = async (file: string, value: unknown) =>
    writeFile(path.join(staging, file), JSON.stringify(value, null, 2) + "\n");
  const readJson = async (file: string) =>
    JSON.parse(await readFile(path.join(staging, file), "utf8"));
  const old = await readJson("project.config.json");
  // Tracking identity and user-confirmed preferences belong to this repository.
  // Derived repositories select their own during Handbook adoption.
  if (names.has("handbook.json")) {
    const handbook = await readJson("handbook.json");
    if (
      handbook.tracking === ".agents/tracking.json" ||
      handbook.preferences === ".agents/repository.md"
    )
      await mkdir(path.join(staging, ".agents"), { recursive: true });
    if (handbook.tracking === ".agents/tracking.json")
      await json(handbook.tracking, {
        version: 1,
        provider: "github",
        organization: null,
        repositories: [],
      });
    if (handbook.preferences === ".agents/repository.md")
      await writeFile(
        path.join(staging, handbook.preferences),
        "# Repository preferences\n\nNot configured. During Handbook adoption, confirm the issue language, integration\nbranch and deployment promotion sources with this repository's owner.\n",
      );
  }
  await json("project.config.json", manifest);
  await writeFile(
    path.join(staging, ".npmrc"),
    "cache=.cache/npm\nsave-exact=true\n",
  );
  const pkg = await readJson("package.json");
  pkg.name = manifest.slug;
  await json("package.json", pkg);
  const lock = await readJson("package-lock.json");
  lock.name = manifest.slug;
  if (lock.packages?.[""]) lock.packages[""].name = manifest.slug;
  await json("package-lock.json", lock);
  const prefix = manifest.slug.replaceAll("-", "_");
  const overrides: Record<string, string> = {
    APP_NAME: JSON.stringify(manifest.displayName),
    APP_STYLE: manifest.defaultStyle,
    FIREBASE_PROJECT_ID: `demo-${manifest.slug}`,
    MONGODB_DATABASE: `${prefix}_local`,
    PAYMENTS_MODE: options.mode === "examples" ? "simulation" : "disabled",
    DIFY_MODE: options.mode === "examples" ? "fake" : "disabled",
    MCP_ENABLED: "false",
    ANDROID_PACKAGE_NAME: manifest.android?.packageName ?? "",
  };
  let env = await readFile(path.join(staging, ".env.example"), "utf8");
  for (const [key, value] of Object.entries(overrides)) {
    const line = new RegExp(`^#? ?${key}=.*$`, "m");
    env = line.test(env)
      ? env.replace(line, () => `${key}=${value}`)
      : env + `\n${key}=${value}\n`;
  }
  await writeFile(path.join(staging, ".env.example"), env);
  const deploy = await readJson("deploy/config.example.json");
  deploy.imageRepository = `ghcr.io/replace-owner/${manifest.slug}`;
  const seed = createHash("sha256")
    .update(manifest.slug)
    .digest()
    .readUInt32BE();
  for (const [i, environment] of ["staging", "production"].entries()) {
    deploy[environment].mongoDatabase = `${prefix}_${environment}`;
    deploy[environment].mongoUser = `${prefix}_${environment}`;
    deploy[environment].firebaseProject =
      `replace-${manifest.slug}-${environment}`;
    deploy[environment].port = 20000 + (seed % 15000) * 2 + i;
    const subnet = (seed % 32768) * 2 + i;
    deploy[environment].ingressSubnet =
      `172.${16 + Math.floor(subnet / 4096)}.${Math.floor(subnet / 16) % 256}.${(subnet % 16) * 16}/28`;
  }
  await json("deploy/config.example.json", deploy);
  // Deployment connections are installation-owned. Only an explicit public
  // profile can opt a derived app into shared services.
  const profile = options.infrastructureProfile as
    Record<string, Record<string, unknown>> | undefined;
  const profileKeys: Record<string, string[]> = {
    ssh: ["host", "user", "cloudflaredVersion", "cloudflaredSha256"],
    shared: [
      "ownerRepository",
      "ownerRef",
      "routeWorkflow",
      "tunnelId",
      "cloudflareAccountId",
      "cloudflareZoneId",
    ],
    atlas: ["projectId", "clusterName", "vpsEgressCidr"],
    google: [
      "stagingProjectId",
      "parent",
      "workloadIdentityProvider",
      "provisionerServiceAccount",
    ],
    deployment: ["redisImage", "nginxImage", "adminImage"],
    ghcr: ["pullUser"],
  };
  if (profile) {
    if (typeof profile !== "object" || Array.isArray(profile))
      throw new Error("Invalid infrastructure profile.");
    for (const [section, values] of Object.entries(profile)) {
      if (
        !profileKeys[section] ||
        !values ||
        typeof values !== "object" ||
        Array.isArray(values)
      )
        throw new Error("Invalid infrastructure profile section.");
      for (const [key, value] of Object.entries(values))
        if (
          !profileKeys[section].includes(key) ||
          (value !== null &&
            (typeof value !== "string" || /[\r\n\0]/.test(value)))
        )
          throw new Error(
            "Infrastructure profiles contain allowlisted public connections only.",
          );
    }
  }
  for (const [i, environment] of ["local", "staging", "production"].entries()) {
    const config = await readJson(`deploy/environments/${environment}.json`);
    config.runtime.APP_NAME = manifest.displayName;
    config.runtime.APP_STYLE = manifest.defaultStyle;
    config.runtime.MONGODB_DATABASE = `${prefix}_${environment}`;
    config.runtime.APP_ENV = environment;
    config.runtime.APP_ORIGIN =
      environment === "local" ? "http://localhost:3000" : null;
    config.runtime.FIREBASE_PROJECT_ID =
      environment === "local" ? `demo-${manifest.slug}` : null;
    config.runtime.AUTH_MODE =
      environment === "local" ? "emulator" : "firebase";
    config.runtime.DIFY_MODE =
      environment === "local" && options.mode === "examples"
        ? "fake"
        : "disabled";
    config.runtime.PAYMENTS_MODE =
      environment === "local" && options.mode === "examples"
        ? "simulation"
        : "disabled";
    config.runtime.MCP_ENABLED = "false";
    // Copy no source provider links, Android association or optional integrations.
    for (const key of Object.keys(config.runtime))
      if (
        ![
          "APP_NAME",
          "APP_STYLE",
          "MONGODB_DATABASE",
          "APP_ENV",
          "APP_ORIGIN",
          "FIREBASE_PROJECT_ID",
          "AUTH_MODE",
          "DIFY_MODE",
          "PAYMENTS_MODE",
          "MCP_ENABLED",
          "ASSET_STORE",
          "MONGODB_URI",
          "FIREBASE_AUTH_EMULATOR_HOST",
        ].includes(key)
      )
        delete config.runtime[key];
    config.runtime.ASSET_STORE = "mongo";
    if (environment === "local") {
      config.runtime.MONGODB_URI = "mongodb://127.0.0.1:27017";
      config.runtime.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    } else {
      delete config.runtime.MONGODB_URI;
      delete config.runtime.FIREBASE_AUTH_EMULATOR_HOST;
    }
    for (const section of Object.keys(profileKeys)) {
      config[section] = Object.fromEntries(
        Object.keys(config[section]).map((key) => [key, null]),
      );
      if (environment !== "local" && profile?.[section])
        for (const [key, value] of Object.entries(profile[section]))
          if (key !== "stagingProjectId") config[section][key] = value;
    }
    config.shared.routeWorkflow ??= "shared-app-routes.yml";
    config.android = {
      host: null,
      packageName: manifest.android?.packageName ?? null,
    };
    config.atlas.mongoUser = `${prefix}_${environment}`;
    config.deployment.imageRepository = `ghcr.io/replace-owner/${manifest.slug}`;
    const deployIndex = Math.max(0, i - 1);
    config.deployment.port = 20000 + (seed % 15000) * 2 + deployIndex;
    const subnet = (seed % 32768) * 2 + deployIndex;
    config.deployment.ingressSubnet = `172.${16 + Math.floor(subnet / 4096)}.${Math.floor(subnet / 16) % 256}.${(subnet % 16) * 16}/28`;
    if (environment === "staging" && profile?.google?.stagingProjectId) {
      config.google.projectId = profile.google.stagingProjectId;
      config.runtime.FIREBASE_PROJECT_ID = profile.google.stagingProjectId;
    }
    await json(`deploy/environments/${environment}.json`, config);
  }
  for (const entry of entries.filter(
    (entry) =>
      entry.name.startsWith(".github/workflows/") ||
      entry.name === "Dockerfile" ||
      entry.name === "public/sw.js",
  )) {
    const file = path.join(staging, entry.name);
    let content = (await readFile(file, "utf8")).replaceAll(
      old.slug,
      manifest.slug,
    );
    if (entry.name.startsWith(".github/workflows/"))
      content = content.replace(
        /^name: (.+)$/m,
        (_, name: string) =>
          "name: " +
          JSON.stringify(
            name
              .replaceAll(old.displayName, () => manifest.displayName)
              .replaceAll("Unibase", () => manifest.displayName),
          ),
      );
    await writeFile(file, content);
  }
  // The next build regenerates the public recovery assets from the new manifest.
  for (const file of ["public/offline.html", "public/offline-locale.js"]) {
    const content = await readFile(path.join(staging, file), "utf8");
    await writeFile(
      path.join(staging, file),
      content
        .replaceAll(
          `${old.slug}-offline-locale`,
          `${manifest.slug}-offline-locale`,
        )
        .replaceAll(`namespace=${old.slug}`, `namespace=${manifest.slug}`),
    );
  }
  await json("project.source.json", {
    version: 1,
    revision,
    mode: options.mode,
  });
  await checkedDestination(source, target);
  try {
    await rmdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(staging, target);
      break;
    } catch (error) {
      // Windows scanners can briefly hold freshly written files. Retry only a
      // transient lock, and never replace a destination created in the meantime.
      if (
        process.platform !== "win32" ||
        attempt >= 5 ||
        !["EPERM", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      try {
        await lstat(target);
        throw error;
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code !== "ENOENT") throw probe;
      }
      await checkedDestination(source, target);
      await delay(100 * (attempt + 1));
    }
  }
  return { destination: target, revision, slug: manifest.slug };
}
