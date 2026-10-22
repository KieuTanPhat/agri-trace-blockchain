import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const monorepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // npm run build enforces both ESLint and Oxlint before invoking Next 16.
  turbopack: { root: monorepoRoot },
};

export default nextConfig;
