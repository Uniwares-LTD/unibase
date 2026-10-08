import { build } from "esbuild";
await build({
  entryPoints: [
    "scripts/payment-worker.ts",
    "scripts/ai-worker.ts",
    "scripts/worker-healthcheck.ts",
  ],
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  // PDFKit resolves packaged resources relative to its own module URL.
  external: ["sharp", "pdfkit"],
  platform: "node",
  target: "node24",
  format: "cjs",
  plugins: [
    {
      name: "server-only-worker",
      setup(builder) {
        // The entry is exclusively server-side; omit the Next-specific import marker.
        builder.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "empty",
        }));
        builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
          contents: "",
        }));
      },
    },
  ],
});
