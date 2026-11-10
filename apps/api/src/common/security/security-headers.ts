import type { NextFunction, Request, Response } from 'express';

/** Also protects direct API responses (including body-parser errors).
 * TLS/HSTS belongs to the HTTPS edge, never a forwarded request header. */
export function securityHeaders(request: Request, response: Response, next: NextFunction) {
  response.removeHeader('X-Powered-By');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-XSS-Protection', '0');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Swagger's interactive UI is local-only; production docs are hidden at Edge.
  if (process.env.NODE_ENV === 'production')
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if (/^\/api\/(?:auth|consumer|staff|payments|enterprise-service|enterprise-billing)(?:\/|$)/.test(request.path))
    response.setHeader('Cache-Control', 'no-store');
  next();
}
