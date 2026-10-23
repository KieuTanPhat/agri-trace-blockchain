import { NextRequest, NextResponse } from "next/server";
import { siteRedirect } from "./lib/site-origins";

export function proxy(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  const input = new URL(request.url);
  // Standalone Next may use its internal listener in request.url. The edge
  // preserves Host; siteRedirect only recognizes the configured authorities.
  const clientHost = request.headers.get("host");
  if (clientHost) {
    input.port = "";
    input.host = clientHost;
  }
  const destination = siteRedirect(input);
  // Temporary redirect: callers must not cache a deployment's host split forever.
  return destination ? NextResponse.redirect(destination, 307) : NextResponse.next();
}
