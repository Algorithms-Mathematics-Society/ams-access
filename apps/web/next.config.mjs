import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { readFileSync } from "node:fs";

// The build's own version, baked in.
//
// `NEXT_PUBLIC_APP_VERSION` was read in two places and set in none, so every
// build ever shipped reported the "2.0.0" fallback. The server's
// minimum-version gate could therefore not tell v1 from v3, and the update
// prompt could not tell whether it was out of date. Both read a constant.
//
// Taken from this package's version, which check-versions.mjs already holds
// equal to the workspace Cargo.toml -- the number the installer is labelled
// with.
const APP_VERSION = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
).version;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },
  experimental: {
    // Our custom chunk splitting disables this memory-saving worker by default.
    webpackBuildWorker: true,
  },
  // Hide the Next.js dev-mode indicator (the bottom-left logomark button). Dev-only cosmetic —
  // it never ships in `output: "export"` production builds; this just keeps dev screenshots clean.
  devIndicators: false,
  images: {
    unoptimized: true,
  },
  // Disable server features — Tauri loads static files
  trailingSlash: true,
  // The packed cppreference book is stored brotli-compressed and is NOT
  // decoded by any code we ship: the browser inflates it in its network layer
  // because the response says so. That is what keeps a 336 MB reference down
  // to 8 MB with no decoder in the bundle.
  //
  // `output: "export"` ignores headers, so this serves `next dev` only. The
  // production path is Tauri's asset protocol, which must set the same header
  // for the blocks; until it does, the Reference tab works in dev only.
  async headers() {
    return [
      {
        source: "/cppref/:block*.br",
        headers: [
          { key: "Content-Encoding", value: "br" },
          { key: "Content-Type", value: "text/html; charset=utf-8" },
        ],
      },
    ];
  },
  webpack: (config, { isServer, dev }) => {
    // Large cache-pack buffers exhaust memory on constrained development machines.
    if (dev) config.cache = false;
    // Carve big third-party libs into their own chunks instead of letting them
    // merge into the large contest-route chunk. This keeps every single chunk
    // under the size budget and improves caching, while leaving the synchronous
    // imports — and the no-flash render path — completely untouched.
    if (!isServer && config.optimization?.splitChunks) {
      config.optimization.splitChunks.cacheGroups = {
        ...config.optimization.splitChunks.cacheGroups,
        // Keep language parsers separate from the other contest dependencies.
        // They remain synchronous dependencies of the editor.
        editorParsers: {
          test: /[\\/]node_modules[\\/]@lezer[\\/].*\.m?js$/,
          name: "editor-parsers",
          enforce: true,
          priority: 40,
          chunks: "all",
          reuseExistingChunk: true,
        },
        // JavaScript only. The root layout imports katex.min.css; a test that
        // also matched that stylesheet put the CSS module in this named chunk,
        // so /layout depended on the whole 257 KiB library and every screen
        // (Welcome, Login, Home, Onboarding, Results) loaded it. Only the
        // contest statement renderer (markdown.ts) needs the JS.
        katex: {
          test: /[\\/]node_modules[\\/]katex[\\/].*\.m?js$/,
          name: "katex",
          priority: 40,
          chunks: "all",
          reuseExistingChunk: true,
        },
      };
    }
    return config;
  },
};

export default (phase) => ({
  ...nextConfig,
  // Dev and production must not overwrite each other's page manifests.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
});
