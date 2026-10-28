/**
 * Ngôn ngữ giao diện Việt / Anh.
 * - Văn bản gốc trong code là tiếng Việt; `t()` tra bản tiếng Anh trong src/lib/i18n-en.ts.
 * - Chuỗi thiếu bản dịch hiển thị nguyên tiếng Việt (không làm hỏng giao diện).
 * - Thông báo lỗi do Backend trả về giữ nguyên ngôn ngữ của Backend (tiếng Việt).
 */
import { EN } from "./i18n-en";

export type Locale = "vi" | "en";
const KEY = "agt-admin.locale";
const listeners = new Set<() => void>();
let current: Locale = "vi";

/** Gọi sau khi mount (tránh lệch HTML server/client lúc hydrate). */
export function restoreLocale() {
  try {
    const saved = window.localStorage.getItem(KEY);
    if ((saved === "en" || saved === "vi") && saved !== current) setLocale(saved);
  } catch {
    /* storage bị chặn */
  }
}

export const getLocale = () => current;
export const subscribeLocale = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export function setLocale(next: Locale) {
  current = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = next;
  listeners.forEach((fn) => fn());
}

/** Dịch một chuỗi tiếng Việt; `{name}` trong chuỗi được thay bằng vars.name. */
export function t(vi: string, vars?: Record<string, unknown>): string {
  let s = current === "en" ? (EN[vi] ?? vi) : vi;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v ?? ""));
  return s;
}

/** Bảng nhãn có giá trị tiếng Việt, đọc ra theo ngôn ngữ hiện tại. */
export function localized<M extends object>(map: M): M {
  return new Proxy(map, {
    get(target, prop) {
      const v = Reflect.get(target, prop);
      return typeof v === "string" ? t(v) : v;
    },
  });
}

export const dateLocale = () => (current === "en" ? "en-GB" : "vi-VN");
