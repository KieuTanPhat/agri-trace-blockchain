import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import { expoWebSecurityHeaders, webSecurityHeaders } from "./src/lib/security-headers";

// Sonner injects one fixed stylesheet at module load, before React mounts.
// Allow those exact bytes rather than allowing every inline <style> element.
const require = createRequire(import.meta.url);
const sonnerSource = readFileSync(require.resolve("sonner"), "utf8");
const sonnerStyles = [...sonnerSource.matchAll(/__insertCSS\(("(?:[^"\\]|\\.)*")\)/g)];
if (sonnerStyles.length !== 1) throw new Error("Review Sonner inline CSS for CSP after dependency changes");
const styleHash = createHash("sha256").update(JSON.parse(sonnerStyles[0][1])).digest("base64");
const offlineHtml = readFileSync(new URL('./public/offline.html', import.meta.url), 'utf8');
const offlineStyle = offlineHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!offlineStyle) throw new Error('Review offline page CSS for CSP');
const offlineStyleHash = createHash('sha256').update(offlineStyle).digest('base64');
const cspEnv = { NEXT_PUBLIC_CSP_STYLE_HASH: styleHash, NEXT_PUBLIC_CSP_OFFLINE_STYLE_HASH: offlineStyleHash };
const securityEnv = { ...process.env, ...cspEnv };

const monorepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Exact dev hostnames only; set the current LAN IP when testing on devices.
  allowedDevOrigins: [
    "127.0.0.1",
    ...(process.env.NEXT_DEV_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  ],
  poweredByHeader: false,
  env: cspEnv,
  agentRules: false,
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // npm run build enforces both ESLint and Oxlint before invoking Next 16.
  turbopack: { root: monorepoRoot },
  async headers() {
    return [
      { source: '/:path*', headers: webSecurityHeaders(securityEnv) },
      ...['consumer', 'staff', 'mobile'].map(prefix => ({
        source: `/${prefix}/:path*`, headers: expoWebSecurityHeaders(securityEnv),
      })),
    ];
  },
  async rewrites(){
    return {beforeFiles:[
      {source:'/consumer/:path*',destination:'/mobile/index.html'},
      {source:'/staff/:path*',destination:'/mobile/index.html'},
      {source:'/_expo/:path*',destination:'/mobile/_expo/:path*'},
      {source:'/assets/:path*',destination:'/mobile/assets/:path*'},
    ],afterFiles:[],fallback:[]};
  },
};

export default nextConfig;
