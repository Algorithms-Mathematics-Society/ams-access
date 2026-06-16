/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
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
        katex: {
          test: /[\\/]node_modules[\\/]katex[\\/]/,
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
