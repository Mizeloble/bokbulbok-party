/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
  // box2d-wasm ships a .wasm file that should not be bundled by Turbopack — load it from node_modules at runtime.
  serverExternalPackages: ['box2d-wasm', 'better-sqlite3'],
};

module.exports = nextConfig;
