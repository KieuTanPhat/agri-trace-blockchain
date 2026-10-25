export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Extract a local trace token; never navigate to a scanned URL. */
export function parseTraceToken(
  input: string,
  allowedOrigin: string,
): string | null {
  const value = input.trim();
  if (
    !value ||
    value.length > 2048 ||
    [...value].some(
      (char) =>
        char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === "\\",
    )
  )
    return null;
  if (TOKEN_PATTERN.test(value)) return value;
  try {
    const url = new URL(value);
    const trusted = new URL(allowedOrigin);
    if (
      !["https:", "http:"].includes(trusted.protocol) ||
      trusted.username ||
      trusted.password ||
      url.origin !== trusted.origin ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      return null;
    const match = /^\/trace\/([A-Za-z0-9_-]{16,128})\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
