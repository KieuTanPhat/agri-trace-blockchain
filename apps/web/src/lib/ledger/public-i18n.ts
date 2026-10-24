/**
 * Dịch chuỗi của trang công khai. Khóa là văn bản tiếng Việt như `t()`; chuỗi
 * không có trong PUBLIC_EN rơi về từ điển chung, rồi về nguyên tiếng Việt.
 */
import { getLocale, t } from "./i18n";
import { PUBLIC_EN } from "./public-i18n-en";

export function pt(vi: string, vars?: Record<string, unknown>): string {
  if (getLocale() !== "en" || !(vi in PUBLIC_EN)) return t(vi, vars);
  let s = PUBLIC_EN[vi];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v ?? ""));
  return s;
}
