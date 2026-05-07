/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  // Disable server features — Tauri loads static files
  trailingSlash: true,
};

export default nextConfig;
