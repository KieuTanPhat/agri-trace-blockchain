const TOKEN = /^[A-Za-z0-9_-]{1,255}$/;

/**
 * Read a trace token from a typed code, a local /trace/<token> path or a QR URL.
 * Mirrors apps/web/src/lib/trace-input.ts: only the token is kept, so a QR code
 * can never send the app to another host.
 */
export function parseTraceToken(value: string): string | null {
  const input = value.trim();
  if (TOKEN.test(input)) return input;
  const local = /^\/trace\/([A-Za-z0-9_-]{1,255})\/?$/.exec(input);
  if (local?.[1]) return local[1];
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const match = /^\/trace\/([^/]+)\/?$/.exec(url.pathname);
    if (!match?.[1]) return null;
    const token = decodeURIComponent(match[1]);
    return TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function isTraceToken(value: string): boolean {
  return TOKEN.test(value);
}
