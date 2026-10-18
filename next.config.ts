import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Derived projects may live beneath another checkout. Keep bundling and the
  // standalone server layout independent of an ancestor's lockfile/workspace.
  outputFileTracingRoot: path.resolve(__dirname),
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingIncludes: {
    "/api/admin/orchestrators/templates/*": ["./dify/**/*.yaml"],
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

export default createNextIntlPlugin()(nextConfig);
