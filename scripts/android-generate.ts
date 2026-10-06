import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { TwaGenerator, TwaManifest, ConsoleLog } from "@bubblewrap/core";
import { parseAndroidConfig } from "./android-config";
import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd(), false);
  const config = parseAndroidConfig(
    JSON.parse(await readFile("android/config.json", "utf8")),
    process.env,
    process.argv.includes("--release"),
  );
  // Bubblewrap fetches icons: serve only our two versioned public images locally,
  // so generation never depends on the production website being deployed.
  const server = createServer(async (req, res) => {
    const file =
      req.url === "/icon.png"
        ? "icon-512.png"
        : req.url === "/maskable.png"
          ? "maskable-512.png"
          : null;
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    try {
      res.setHeader("Content-Type", "image/png");
      res.end(await readFile(`public/icons/${file}`));
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Icon server unavailable.");
    const base = `http://127.0.0.1:${address.port}`;
    const manifest = new TwaManifest({
      packageId: config.packageId,
      host: config.host,
      name: "Unitale",
      launcherName: "Unitale",
      display: "standalone",
      themeColor: "#98492f",
      navigationColor: "#fff9f3",
      backgroundColor: "#fff9f3",
      enableNotifications: false,
      enableSiteSettingsShortcut: false,
      startUrl: "/",
      splashScreenFadeOutDuration: 0,
      iconUrl: `${base}/icon.png`,
      maskableIconUrl: `${base}/maskable.png`,
      signingKey: { path: "upload.keystore", alias: "unitale" },
      appVersionCode: config.versionCode,
      appVersion: config.versionName,
      generatorApp: "bubblewrap-1.25.0",
      fallbackType: "customtabs",
      minSdkVersion: 23,
      shortcuts: [],
      features: {},
      additionalTrustedOrigins: [],
    });
    await mkdir("android/project", { recursive: true });
    await new TwaGenerator().createTwaProject(
      "android/project",
      manifest,
      new ConsoleLog("unitale"),
    );
    manifest.iconUrl = `https://${config.host}/icons/icon-512.png`;
    manifest.maskableIconUrl = `https://${config.host}/icons/maskable-512.png`;
    manifest.webManifestUrl = new URL(
      `https://${config.host}/manifest.webmanifest`,
    );
    await manifest.saveToFile("android/project/twa-manifest.json");
    const buildFile = "android/project/build.gradle";
    const generatedBuild = await readFile(buildFile, "utf8");
    const upstreamPlugin = "com.android.tools.build:gradle:8.9.1";
    // Bubblewrap 1.25.0 targets API 36, but its AGP 8.9 template only supports
    // API 35. AGP 8.10 supports 36 with the same Gradle 8.11.1 / Java 17 setup.
    if (!generatedBuild.includes(upstreamPlugin))
      throw new Error(
        "Bubblewrap Gradle plugin changed; review the API 36 adaptation.",
      );
    await writeFile(
      buildFile,
      generatedBuild
        .replace(upstreamPlugin, "com.android.tools.build:gradle:8.10.1")
        .replaceAll("jcenter()", "mavenCentral()"),
    );
    await writeFile(
      "android/project/app/build.gradle",
      (await readFile("android/project/app/build.gradle", "utf8")) +
        '\napply from: "../../release-signing.gradle"\n',
    );
    console.log(
      "Generated Android project from environment identity and android/config.json version. No signing keys created.",
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
main().catch((error: unknown) => {
  console.error(
    "Android generation failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
