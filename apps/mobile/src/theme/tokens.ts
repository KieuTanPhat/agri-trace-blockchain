import type { TextStyle } from "react-native";
import { Platform } from "react-native";

import raw from "../../design/tokens.json";

/** Themes defined by design/tokens.json; the first one is the fallback for missing values. */
export const THEME_IDS = ["light", "dark", "outdoor"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const COLOR_NAMES = [
  "bg",
  "surface",
  "surface-sunken",
  "cream",
  "forest",
  "on-forest",
  "ink",
  "ink-soft",
  "muted",
  "subtle",
  "line",
  "control-border",
  "primary",
  "primary-strong",
  "on-primary",
  "primary-soft",
  "leaf",
  "accent",
  "on-accent",
  "accent-ink",
  "accent-soft",
  "success",
  "success-bg",
  "warning",
  "warning-bg",
  "danger",
  "danger-bg",
  "info",
  "info-bg",
  "neutral",
  "neutral-bg",
  "focus",
  "scrim",
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];
export type Palette = Record<ColorName, string>;

type ThemedValue = string | Partial<Record<ThemeId, string>>;
type RawToken = { name: string; value: ThemedValue };

function valueFor(value: ThemedValue, theme: ThemeId): string {
  if (typeof value === "string") return value;
  const resolved = value[theme] ?? value[THEME_IDS[0]];
  if (!resolved) throw new Error(`Token has no value for theme ${theme}`);
  return resolved;
}

function palette(theme: ThemeId): Palette {
  const tokens = new Map((raw.color.tokens as RawToken[]).map((token) => [token.name, token.value]));
  const result = {} as Palette;
  for (const name of COLOR_NAMES) {
    const value = tokens.get(name);
    if (value === undefined) throw new Error(`design/tokens.json is missing color ${name}`);
    result[name] = valueFor(value, theme);
  }
  return result;
}

export const palettes: Record<ThemeId, Palette> = {
  light: palette("light"),
  dark: palette("dark"),
  outdoor: palette("outdoor"),
};

function pixels(tokens: { name: string; value: string }[]): Record<string, number> {
  return Object.fromEntries(tokens.map((token) => [token.name, Number.parseFloat(token.value)]));
}

const spacing = pixels(raw.spacing.tokens);
const radii = pixels(raw.radius.tokens);

function px(map: Record<string, number>, name: string): number {
  const value = map[name];
  if (value === undefined || Number.isNaN(value)) throw new Error(`Unknown size token ${name}`);
  return value;
}

export const space = {
  s1: px(spacing, "s-1"),
  s2: px(spacing, "s-2"),
  s3: px(spacing, "s-3"),
  s4: px(spacing, "s-4"),
  s5: px(spacing, "s-5"),
  s6: px(spacing, "s-6"),
  s7: px(spacing, "s-7"),
  touchMin: px(spacing, "touch-min"),
  touchField: px(spacing, "touch-field"),
} as const;

export const radius = {
  sm: px(radii, "r-sm"),
  md: px(radii, "r-md"),
  lg: px(radii, "r-lg"),
  xl: px(radii, "r-xl"),
  full: px(radii, "r-full"),
} as const;

/** Each weight is a separate family so custom fonts render the same on iOS and Android. */
export const FONT_FILES = {
  "BeVietnamPro-Regular": 400,
  "BeVietnamPro-Medium": 500,
  "BeVietnamPro-SemiBold": 600,
  "BeVietnamPro-Bold": 700,
  "BeVietnamPro-ExtraBold": 800,
} as const;

function sansFamily(weight: number): string {
  const entry = Object.entries(FONT_FILES).find(([, value]) => value === weight);
  if (!entry) throw new Error(`No Be Vietnam Pro face for weight ${weight}`);
  return entry[0];
}

const monoFamily = Platform.select({ ios: "Menlo", default: "monospace" });

export type TypeStyleName =
  | "display"
  | "metric"
  | "title-1"
  | "title-2"
  | "headline"
  | "body"
  | "body-strong"
  | "body-sm"
  | "label"
  | "caption"
  | "code";

type RawStyle = { name: string; fontSize: string; lineHeight: string; fontWeight: number; letterSpacing?: string };

export const typography = Object.fromEntries(
  raw.type.groups.flatMap((group) =>
    (group.styles as RawStyle[]).map((style): [string, TextStyle] => [
      style.name,
      {
        fontFamily: group.family === "mono" ? monoFamily : sansFamily(style.fontWeight),
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
        ...(group.family === "mono" ? { fontWeight: "500" } : {}),
        ...(style.letterSpacing ? { letterSpacing: Number.parseFloat(style.letterSpacing) } : {}),
      },
    ]),
  ),
) as Record<TypeStyleName, TextStyle>;
