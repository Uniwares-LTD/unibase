import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdfkit"],
  // Next traces PDFKit's ESM dependency entries; the standalone CJS worker also
  // needs the CommonJS entries selected by PDFKit's require() calls.
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/@noble/hashes/**/*.js",
      "node_modules/@noble/ciphers/**/*.js",
      "node_modules/fflate/lib/*.cjs",
      "node_modules/restructure/dist/*.cjs",
      "node_modules/unicode-properties/dist/*.cjs",
      "node_modules/linebreak/dist/*.cjs",
      "node_modules/@swc/helpers/cjs/*.cjs",
    ],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
  // Type errors are reported separately by typecheck/validate, per the agreed
  // advisory quality policy. Compilation and bundling failures still fail build.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
