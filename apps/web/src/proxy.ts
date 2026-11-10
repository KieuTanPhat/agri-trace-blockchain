import { NextRequest, NextResponse } from "next/server";
import { siteRedirect } from "./lib/site-origins";
import { webSecurityHeaders } from "./lib/security-headers";

export function proxy(request: NextRequest) {
  const input = new URL(request.url);
  // Standalone Next may use its internal listener in request.url. The edge
  // preserves Host; siteRedirect only recognizes the configured authorities.
  const clientHost = request.headers.get("host");
  if (clientHost) {
    input.port = "";
    input.host = clientHost;
  }
  const destination = request.method === "GET" || request.method === "HEAD" ? siteRedirect(input) : null;
  // Temporary redirect: callers must not cache a deployment's host split forever.
  if (destination) return NextResponse.redirect(destination, 307);
  if (/^\/(?:api|_next|consumer|staff|mobile|assets|_expo)(?:\/|$)/.test(input.pathname)
    || /\.[a-z0-9]+$/i.test(input.pathname)) return NextResponse.next();
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const security = webSecurityHeaders(process.env, nonce);
  const csp = security.find(header => header.key === 'Content-Security-Policy')!.value;
  const headers = new Headers(request.headers);
  // Never accept a client-supplied nonce or CSP as render authority.
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  for (const { key, value } of security) response.headers.set(key, value);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
