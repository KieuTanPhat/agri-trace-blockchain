/** Display typography chosen in Cài đặt: one font for the whole workspace plus
 * font, size and weight per kind of text. Kept per browser (localStorage); an
 * empty value keeps the built-in design. Google fonts load only when chosen. */

export type FontOption = {
  id: string;
  label: string;
  family: string;
  /** Google Fonts family name and weights; absent for fonts already present. */
  google?: string;
  weights?: string;
  group: "Không chân" | "Có chân" | "Trang trí" | "Đơn cách" | "Hệ thống";
};

const sans = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const serif = 'Georgia, "Times New Roman", serif';
const mono = 'ui-monospace, Consolas, "Courier New", monospace';

export const FONTS: FontOption[] = [
  { id: "inter", label: "Inter (mặc định)", family: `var(--font-inter, "Inter"), ${sans}`, group: "Không chân" },
  { id: "be-vietnam-pro", label: "Be Vietnam Pro", family: `"Be Vietnam Pro", ${sans}`, google: "Be Vietnam Pro", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "roboto", label: "Roboto", family: `"Roboto", ${sans}`, google: "Roboto", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "open-sans", label: "Open Sans", family: `"Open Sans", ${sans}`, google: "Open Sans", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "noto-sans", label: "Noto Sans", family: `"Noto Sans", ${sans}`, google: "Noto Sans", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "montserrat", label: "Montserrat", family: `"Montserrat", ${sans}`, google: "Montserrat", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "nunito", label: "Nunito", family: `"Nunito", ${sans}`, google: "Nunito", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "nunito-sans", label: "Nunito Sans", family: `"Nunito Sans", ${sans}`, google: "Nunito Sans", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "source-sans-3", label: "Source Sans 3", family: `"Source Sans 3", ${sans}`, google: "Source Sans 3", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "mulish", label: "Mulish", family: `"Mulish", ${sans}`, google: "Mulish", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "manrope", label: "Manrope", family: `"Manrope", ${sans}`, google: "Manrope", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "lexend", label: "Lexend (dễ đọc)", family: `"Lexend", ${sans}`, google: "Lexend", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "plus-jakarta-sans", label: "Plus Jakarta Sans", family: `"Plus Jakarta Sans", ${sans}`, google: "Plus Jakarta Sans", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "work-sans", label: "Work Sans", family: `"Work Sans", ${sans}`, google: "Work Sans", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "raleway", label: "Raleway", family: `"Raleway", ${sans}`, google: "Raleway", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "fira-sans", label: "Fira Sans", family: `"Fira Sans", ${sans}`, google: "Fira Sans", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", family: `"IBM Plex Sans", ${sans}`, google: "IBM Plex Sans", weights: "300;400;500;600;700", group: "Không chân" },
  { id: "barlow", label: "Barlow", family: `"Barlow", ${sans}`, google: "Barlow", weights: "300;400;500;600;700;800", group: "Không chân" },
  { id: "arimo", label: "Arimo", family: `"Arimo", ${sans}`, google: "Arimo", weights: "400;500;600;700", group: "Không chân" },
  { id: "quicksand", label: "Quicksand", family: `"Quicksand", ${sans}`, google: "Quicksand", weights: "300;400;500;600;700", group: "Không chân" },
  { id: "josefin-sans", label: "Josefin Sans", family: `"Josefin Sans", ${sans}`, google: "Josefin Sans", weights: "300;400;500;600;700", group: "Không chân" },
  { id: "space-grotesk", label: "Space Grotesk", family: `"Space Grotesk", ${sans}`, google: "Space Grotesk", weights: "300;400;500;600;700", group: "Không chân" },
  { id: "oswald", label: "Oswald (chữ hẹp)", family: `"Oswald", ${sans}`, google: "Oswald", weights: "300;400;500;600;700", group: "Trang trí" },
  { id: "playfair-display", label: "Playfair Display", family: `"Playfair Display", ${serif}`, google: "Playfair Display", weights: "400;500;600;700;800", group: "Trang trí" },
  { id: "noto-serif", label: "Noto Serif", family: `"Noto Serif", ${serif}`, google: "Noto Serif", weights: "300;400;500;600;700;800", group: "Có chân" },
  { id: "merriweather", label: "Merriweather", family: `"Merriweather", ${serif}`, google: "Merriweather", weights: "300;400;700", group: "Có chân" },
  { id: "lora", label: "Lora", family: `"Lora", ${serif}`, google: "Lora", weights: "400;500;600;700", group: "Có chân" },
  { id: "roboto-slab", label: "Roboto Slab", family: `"Roboto Slab", ${serif}`, google: "Roboto Slab", weights: "300;400;500;600;700;800", group: "Có chân" },
  { id: "eb-garamond", label: "EB Garamond", family: `"EB Garamond", ${serif}`, google: "EB Garamond", weights: "400;500;600;700;800", group: "Có chân" },
  { id: "tinos", label: "Tinos", family: `"Tinos", ${serif}`, google: "Tinos", weights: "400;700", group: "Có chân" },
  { id: "roboto-mono", label: "Roboto Mono", family: `"Roboto Mono", ${mono}`, google: "Roboto Mono", weights: "300;400;500;600;700", group: "Đơn cách" },
  { id: "jetbrains-mono", label: "JetBrains Mono", family: `"JetBrains Mono", ${mono}`, google: "JetBrains Mono", weights: "300;400;500;600;700;800", group: "Đơn cách" },
  { id: "arial", label: "Arial", family: `Arial, Helvetica, sans-serif`, group: "Hệ thống" },
  { id: "segoe-ui", label: "Segoe UI", family: `"Segoe UI", ${sans}`, group: "Hệ thống" },
  { id: "tahoma", label: "Tahoma", family: `Tahoma, Verdana, sans-serif`, group: "Hệ thống" },
  { id: "verdana", label: "Verdana", family: `Verdana, Geneva, sans-serif`, group: "Hệ thống" },
  { id: "times-new-roman", label: "Times New Roman", family: `"Times New Roman", Times, serif`, group: "Hệ thống" },
  { id: "georgia", label: "Georgia", family: `Georgia, serif`, group: "Hệ thống" },
];

export const WEIGHTS: [number, string][] = [
  [300, "Mảnh (300)"],
  [400, "Thường (400)"],
  [500, "Vừa (500)"],
  [600, "Đậm vừa (600)"],
  [700, "Đậm (700)"],
  [800, "Rất đậm (800)"],
];

export type TextRole = {
  id: string;
  label: string;
  hint: string;
  /** Elements in the workspace this setting changes. */
  selector: string;
  /** Matching element in the settings preview. */
  sample: string;
  /** Built-in size in px, shown as the placeholder. */
  baseSize: number;
};

export const TEXT_ROLES: TextRole[] = [
  { id: "pageTitle", label: "Tiêu đề trang", hint: "Tên trang, ví dụ “Thành viên doanh nghiệp”", selector: ".content h1", sample: ".ts-h1", baseSize: 28 },
  { id: "sectionTitle", label: "Tiêu đề mục", hint: "Tên khối, thẻ, nhóm trường", selector: ".content :is(h2, h3, legend)", sample: ".ts-h2", baseSize: 17 },
  { id: "body", label: "Nội dung chung", hint: "Đoạn văn, danh sách, mô tả chi tiết", selector: ".content :is(p, li, dd)", sample: ".ts-body", baseSize: 14 },
  { id: "muted", label: "Ghi chú / chữ phụ", hint: "Mô tả dưới tiêu đề, chú thích nhỏ", selector: ".content :is(small, .muted, .manage-description)", sample: ".ts-muted", baseSize: 13 },
  { id: "label", label: "Nhãn trường nhập", hint: "Tên ô trong biểu mẫu", selector: ".content :is(label, dt, .field > span)", sample: ".ts-label", baseSize: 13 },
  { id: "input", label: "Ô nhập / ô chọn", hint: "Chữ người dùng gõ hoặc chọn", selector: ".app-shell :is(input, select, textarea, .input, .select)", sample: ".ts-input", baseSize: 13 },
  { id: "tableHead", label: "Bảng · tiêu đề cột", hint: "Hàng đầu của mọi bảng", selector: ".content th", sample: ".ts-th", baseSize: 12 },
  { id: "tableCell", label: "Bảng · dữ liệu", hint: "Các ô dữ liệu trong bảng", selector: ".content td", sample: ".ts-td", baseSize: 13 },
  { id: "button", label: "Nút bấm", hint: "Nút lưu, tạo mới, thao tác", selector: ".app-shell :is(.button, button)", sample: ".ts-button", baseSize: 13 },
  { id: "link", label: "Liên kết thao tác", hint: "“Xem chi tiết”, “Quyền & trạng thái”…", selector: ".content .text-link", sample: ".ts-link", baseSize: 13 },
  { id: "badge", label: "Nhãn trạng thái", hint: "“Đang hoạt động”, “Cấp 2”…", selector: ".content :is(.manage-status, .workspace-badge)", sample: ".ts-badge", baseSize: 12 },
  { id: "metric", label: "Số liệu thống kê", hint: "Con số lớn ở tổng quan", selector: ".content :is(.manage-metric strong, .workspace-stat strong)", sample: ".ts-metric", baseSize: 28 },
  { id: "nav", label: "Menu bên trái", hint: "Mục điều hướng trong thanh bên", selector: ".sidebar :is(.nav-link, .nav-group-title)", sample: ".ts-nav", baseSize: 13 },
  { id: "topbar", label: "Thanh trên cùng", hint: "Đường dẫn, tìm kiếm, tên tài khoản", selector: ".topbar :is(a, strong, span, small, summary)", sample: ".ts-topbar", baseSize: 12 },
];

export type RoleStyle = { font?: string; size?: number; weight?: number };
export type Typography = { font?: string; roles: Record<string, RoleStyle> };

export const DEFAULT_TYPOGRAPHY: Typography = { roles: {} };
export const TYPOGRAPHY_EVENT = "agritrace:typography";
const STORAGE_KEY = "agritrace:typography:v1";

export const PRESETS: { id: string; label: string; value: Typography }[] = [
  { id: "default", label: "Thiết kế gốc", value: DEFAULT_TYPOGRAPHY },
  {
    id: "readable",
    label: "Chữ lớn, dễ đọc",
    value: {
      font: "lexend",
      roles: {
        body: { size: 16 }, muted: { size: 14 }, label: { size: 15 }, input: { size: 15 },
        tableHead: { size: 14 }, tableCell: { size: 15 }, button: { size: 15 }, link: { size: 15 }, nav: { size: 15 },
      },
    },
  },
  {
    id: "compact",
    label: "Gọn, nhiều dữ liệu",
    value: {
      font: "ibm-plex-sans",
      roles: { body: { size: 13 }, tableHead: { size: 11, weight: 600 }, tableCell: { size: 12 }, label: { size: 12 }, input: { size: 12 }, nav: { size: 12 } },
    },
  },
  {
    id: "formal",
    label: "Trang trọng (có chân)",
    value: {
      font: "noto-sans",
      roles: { pageTitle: { font: "playfair-display", weight: 700, size: 32 }, sectionTitle: { font: "lora", weight: 600 }, metric: { font: "lora", weight: 700 } },
    },
  },
];

export function fontById(id?: string) {
  return FONTS.find((font) => font.id === id);
}

export function loadTypography(): Typography {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TYPOGRAPHY;
    const parsed = JSON.parse(raw) as Typography;
    return { font: parsed.font, roles: parsed.roles ?? {} };
  } catch {
    return DEFAULT_TYPOGRAPHY;
  }
}

export function saveTypography(value: Typography) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage may be blocked; the change still applies until reload.
  }
  window.dispatchEvent(new CustomEvent(TYPOGRAPHY_EVENT, { detail: value }));
}

/** Adds the stylesheet of every Google font the value uses, once each. */
export function loadFonts(value: Typography) {
  const ids = new Set([value.font, ...Object.values(value.roles).map((role) => role.font)]);
  for (const id of ids) {
    const font = fontById(id);
    if (!font?.google) continue;
    const linkId = `font-${font.id}`;
    if (document.getElementById(linkId)) continue;
    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.google).replace(/%20/g, "+")}:wght@${font.weights}&subset=vietnamese&display=swap`;
    document.head.appendChild(link);
  }
}

function declarations(style: RoleStyle) {
  const parts: string[] = [];
  const font = fontById(style.font);
  if (font) parts.push(`font-family: ${font.family} !important;`);
  if (style.size) parts.push(`font-size: ${style.size}px !important;`);
  if (style.weight) parts.push(`font-weight: ${style.weight} !important;`);
  return parts.join(" ");
}

/** CSS for the workspace (`scope` undefined) or for one preview container. */
export function typographyCss(value: Typography, scope?: string) {
  const rules: string[] = [];
  // A preview sits inside the workspace and would inherit its saved font, so
  // it always states its own (the built-in one when none is chosen).
  const global = fontById(value.font) ?? (scope ? FONTS[0] : undefined);
  if (global) {
    const root = scope ?? ".app-shell";
    const inner = scope
      ? `${scope}, ${scope} *`
      : `.app-shell, .app-shell :is(input, select, textarea, button):not(.typo-preview *)`;
    rules.push(`${root} { --font: ${global.family}; }`);
    rules.push(`${inner} { font-family: ${global.family} !important; }`);
  }
  for (const role of TEXT_ROLES) {
    const style = value.roles[role.id];
    if (!style) continue;
    const css = declarations(style);
    if (!css) continue;
    const selector = scope
      ? `${scope} ${role.sample}`
      : `:is(${role.selector}):not(.typo-preview *)`;
    rules.push(`${selector} { ${css} }`);
  }
  return rules.join("\n");
}

/** Applies the saved choice to the whole workspace. */
export function applyTypography(value: Typography) {
  loadFonts(value);
  let style = document.getElementById("agritrace-typography") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "agritrace-typography";
    document.head.appendChild(style);
  }
  style.textContent = typographyCss(value);
}
