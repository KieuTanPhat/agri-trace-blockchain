import { dateLocale, getLocale } from "./i18n";

const TZ = "Asia/Ho_Chi_Minh";

// Định dạng theo ngôn ngữ giao diện (vi-VN / en-GB), luôn theo giờ Việt Nam.
const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();
function fmt<F extends Intl.DateTimeFormat | Intl.NumberFormat>(kind: string, make: (l: string) => F): F {
  const k = kind + dateLocale();
  if (!cache.has(k)) cache.set(k, make(dateLocale()));
  return cache.get(k) as F;
}
const dt = { format: (x: Date) => fmt("dt", (l) => new Intl.DateTimeFormat(l, { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })).format(x) };
const d = { format: (x: Date) => fmt("d", (l) => new Intl.DateTimeFormat(l, { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" })).format(x) };
const short = { format: (x: Date) => fmt("s", (l) => new Intl.DateTimeFormat(l, { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })).format(x) };
const num = { format: (x: number) => fmt("n", (l) => new Intl.NumberFormat(l)).format(x) };
const money = { format: (x: number) => fmt("m", (l) => new Intl.NumberFormat(l, { style: "currency", currency: "VND", maximumFractionDigits: 0 })).format(x) };
const en = () => getLocale() === "en";

export const fmtDateTime = (v?: string | null) => (v ? dt.format(new Date(v)) : "—");
export const fmtDate = (v?: string | null) => (v ? d.format(new Date(v)) : "—");
export const fmtShort = (v?: string | null) => (v ? short.format(new Date(v)) : "—");
export const fmtNumber = (v?: number | string | null) => (v === null || v === undefined || v === "" ? "—" : num.format(Number(v)));
export const fmtMoney = (v?: number | null) => (v === null || v === undefined ? "—" : money.format(v));
export const fmtQty = (v: string, unit: string) => `${num.format(Number(v))} ${unit}`;
export const shortHash = (h?: string | null, n = 6) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");
export const shortId = (id?: string | null) => (id ? id.slice(-8) : "—");
export const fmtBytes = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** "3 giờ", "2 ngày" — khoảng thời gian không dấu. */
export function fmtSpan(ms: number) {
  const a = Math.abs(ms);
  const m = Math.round(a / 60000);
  if (m < 60) return en() ? `${m} min` : `${m} phút`;
  const h = Math.round(a / 3_600_000);
  if (h < 48) return en() ? `${h} h` : `${h} giờ`;
  const days = Math.round(a / 86_400_000);
  return en() ? `${days} day${days === 1 ? "" : "s"}` : `${days} ngày`;
}
/** "quá 2 giờ" / "còn 5 giờ" so với bây giờ. */
export function fmtDue(iso?: string | null, now = Date.now()) {
  if (!iso) return { text: "—", overdue: false };
  const diff = Date.parse(iso) - now;
  if (en()) return diff < 0 ? { text: `${fmtSpan(diff)} overdue`, overdue: true } : { text: `${fmtSpan(diff)} left`, overdue: false };
  return diff < 0 ? { text: `quá ${fmtSpan(diff)}`, overdue: true } : { text: `còn ${fmtSpan(diff)}`, overdue: false };
}
export function fmtAgo(iso?: string | null, now = Date.now()) {
  if (!iso) return "—";
  const diff = now - Date.parse(iso);
  if (diff < 60_000) return en() ? "just now" : "vừa xong";
  return en() ? `${fmtSpan(diff)} ago` : `${fmtSpan(diff)} trước`;
}
export function fmtSeconds(s?: number | null) {
  if (s === null || s === undefined) return "—";
  return fmtSpan(s * 1000);
}
