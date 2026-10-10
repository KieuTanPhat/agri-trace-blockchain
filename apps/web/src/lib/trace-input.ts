const TOKEN = /^[A-Za-z0-9_-]{1,255}$/;

/** Read a public token or QR URL; navigation always stays on the local trace route. */
export function getTracePath(value: string): string | null {
  const input = value.trim();
  if (TOKEN.test(input)) return `/trace/${input}`;
  const local = /^\/trace\/([A-Za-z0-9_-]{1,255})\/?$/.exec(input);
  if (local) return `/trace/${local[1]}`;
  try {
    const url = new URL(input);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    const match = /^\/trace\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return null;
    const token = decodeURIComponent(match[1]);
    return TOKEN.test(token) ? `/trace/${token}` : null;
  } catch {
    return null;
  }
}
