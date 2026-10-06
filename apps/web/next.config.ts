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
  // npm run build enforces both ESLint and Oxlint before invoking Next.
  // Next 15's embedded ESLint runner cannot run the Oxlint Next.js rules.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
