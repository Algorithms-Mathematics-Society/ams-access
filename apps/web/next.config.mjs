/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  // Hide the Next.js dev-mode indicator (the bottom-left logomark button). Dev-only cosmetic —
  // it never ships in `output: "export"` production builds; this just keeps dev screenshots clean.
  devIndicators: false,
  images: {
    unoptimized: true,
  },
  // Disable server features — Tauri loads static files
  trailingSlash: true,
  webpack: (config, { isServer }) => {
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

export default nextConfig;
