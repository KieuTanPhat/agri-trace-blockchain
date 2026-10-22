/** Workspace display preferences, stored only on this browser. */
export const APPEARANCE_EVENT = "agritrace:appearance";
const STORAGE_KEY = "agritrace:appearance:v1";
export const THEMES = [
  {
    id: "default",
    label: "Mặc định",
    primary: "#087a3f",
    secondary: "#19a65e",
    accent: "#f58a00",
    background: "#f4f7f3",
  },
  {
    id: "green",
    label: "Xanh lá",
    primary: "#166534",
    secondary: "#22c55e",
    accent: "#15803d",
    background: "#f5f9f6",
  },
  {
    id: "blue",
    label: "Xanh dương",
    primary: "#1d4ed8",
    secondary: "#3b82f6",
    accent: "#0369a1",
    background: "#f5f8fc",
  },
  {
    id: "purple",
    label: "Tím",
    primary: "#6d28d9",
    secondary: "#8b5cf6",
    accent: "#7e22ce",
    background: "#f8f6fc",
  },
] as const;
export type Appearance = {
  theme: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  density: "comfortable" | "standard" | "compact" | "dense";
  width: "narrow" | "default" | "wide";
  autoSave: boolean;
};
export const DEFAULT_APPEARANCE: Appearance = {
  theme: THEMES[0].id,
  primary: THEMES[0].primary,
  secondary: THEMES[0].secondary,
  accent: THEMES[0].accent,
  background: THEMES[0].background,
  density: "standard",
  width: "default",
  autoSave: false,
};
const hex = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
export function normalizeAppearance(
  value: Partial<Appearance> | null,
): Appearance {
  return {
    theme: [...THEMES.map((t) => t.id), "custom"].includes(value?.theme ?? "")
      ? value!.theme!
      : "default",
    primary: hex(value?.primary, DEFAULT_APPEARANCE.primary),
    secondary: hex(value?.secondary, DEFAULT_APPEARANCE.secondary),
    accent: hex(value?.accent, DEFAULT_APPEARANCE.accent),
    background: hex(value?.background, DEFAULT_APPEARANCE.background),
    density: ["comfortable", "standard", "compact", "dense"].includes(
      value?.density ?? "",
    )
      ? value!.density!
      : "standard",
    width: ["narrow", "default", "wide"].includes(value?.width ?? "")
      ? value!.width!
      : "default",
    autoSave: value?.autoSave === true,
  };
}
export function loadAppearance(): Appearance {
  try {
    return normalizeAppearance(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
  } catch {
    return DEFAULT_APPEARANCE;
  }
}
export function saveAppearance(value: Appearance): boolean {
  let stored = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    stored = false;
  }
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: value }));
  return stored;
}
export function appearanceCss(value: Appearance, scope = ".app-shell:not(.shadcn-workspace)") {
  const v = normalizeAppearance(value);
  const padding = { comfortable: 14, standard: 10, compact: 7, dense: 4 }[
    v.density
  ];
  // The default workspace fills the shell, including previously saved defaults.
  const width = v.width === "narrow" ? "1120px" : "none";
  const margin = v.width === "narrow" ? "auto" : "0";
  return `${scope} {
    --green-950: color-mix(in srgb, ${v.primary} 24%, #000);
    --green-900: color-mix(in srgb, ${v.primary} 40%, #000);
    --green-800: color-mix(in srgb, ${v.primary} 82%, #000);
    --green-700: ${v.primary}; --green-600: ${v.primary}; --green-500: ${v.secondary};
    --green-300: color-mix(in srgb, ${v.secondary} 48%, #fff);
    --green-200: color-mix(in srgb, ${v.primary} 25%, #fff);
    --green-100: color-mix(in srgb, ${v.primary} 12%, #fff);
    --green-50: color-mix(in srgb, ${v.primary} 6%, #fff);
    --primary: ${v.primary}; --primary-strong: var(--green-800); --primary-soft: var(--green-50);
    --accent: ${v.accent}; --focus: ${v.primary}; --mist: ${v.background};
    --display-row-padding: ${padding}px;
  }
  ${scope} :is(.content, .ts-main) { background: ${v.background}; }
  ${scope} :is(.sidebar, .ts-side) { background: var(--green-950); }
  ${scope} .page-content { width: 100%; max-width: ${width}; margin-inline: ${margin}; }
  ${scope} :is(.manage-table, .settings-sample-table) :is(th, td) { padding-block: var(--display-row-padding); }
  ${scope} .ts-nav-active { background: var(--primary); color: #fff; }
  ${scope} .ts-button { background: var(--primary); }
  ${scope} .ts-link { color: var(--primary); }
  .shadcn-workspace { --display-row-padding: ${padding}px; ${v.theme !== "default" ? `--ui-primary: ${v.primary}; --ui-primary-foreground: #fff;` : ""} }
  .light .shadcn-workspace { ${v.theme !== "default" ? `--ui-background: ${v.background}; --ui-secondary: ${v.secondary};` : ""} }
  .shadcn-workspace .page-content { max-width: ${width}; margin-inline: ${margin}; }
  .shadcn-workspace .manage-table :is(th, td) { padding-block: var(--display-row-padding); }`;
}
export function applyAppearance(value: Appearance) {
  let style = document.getElementById(
    "agritrace-appearance",
  ) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "agritrace-appearance";
    document.head.appendChild(style);
  }
  style.textContent = appearanceCss(value);
}
