const tz = 'Asia/Ho_Chi_Minh';

/** Vietnamese formats: 1.240 kg, 14/10/2026 · 06:40, 24-hour clock. */
export const qty = (value: number | string, unit?: string | null) => {
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) : String(value);
  return unit ? `${text} ${unit}` : text;
};

export const date = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('vi-VN', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export const dateTime = (iso?: string | null) =>
  iso
    ? `${date(iso)} · ${new Date(iso).toLocaleTimeString('vi-VN', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })}`
    : '—';

// Docker passes the public trace base URL (including /trace), while Metro uses
// an origin. Compare origins consistently and fail closed for bad configuration.
const TRACE_ORIGIN = (() => {
  try {
    const url = new URL(process.env.EXPO_PUBLIC_TRACE_ORIGIN ?? 'http://localhost:3000');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.origin : null;
  } catch { return null; }
})();
const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Printed trace token from a raw scan: a bare token, or a trace URL on the
 * configured Web origin. Any other link is ignored, never opened.
 */
export function parseTraceToken(raw: string) {
  const text = raw.trim();
  if (!/^https?:\/\//i.test(text)) return TOKEN.test(text) ? text : null;
  try {
    const url = new URL(text);
    if (url.origin !== TRACE_ORIGIN) return null;
    const match = url.pathname.match(/^\/trace\/([A-Za-z0-9_-]{8,128})\/?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
