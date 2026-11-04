import type { TextStyle } from 'react-native';

/**
 * One palette for both apps: neutral slate surfaces, a single brand green
 * (apps/web/src/styles/tokens.css) and muted status tints, so screens read as
 * a calm operations tool rather than a set of colourful tiles.
 */
export const color = {
  bg: '#f3f8f1',
  surface: '#ffffff',
  ink: '#111827',
  inkSoft: '#374151',
  muted: '#6b7280',
  faint: '#9ca3af',
  line: '#e7eee5',
  field: '#d1d5db',
  green: '#1f8a4c',
  greenDeep: '#176c3b',
  greenTint: '#e6f4e4',
  teal: '#0f766e',
  orange: '#d97706',
  orangeDeep: '#b45309',
  orangeTint: '#fef3c7',
  blue: '#2563eb',
  blueDeep: '#1d4ed8',
  blueTint: '#e0ecff',
  purple: '#7c3aed',
  purpleDeep: '#6d28d9',
  purpleTint: '#ede9fe',
  red: '#dc2626',
  redDeep: '#b91c1c',
  redTint: '#fee2e2',
  warn: '#92400e',
  warnBg: '#fffbeb',
  warnLine: '#fde68a',
} as const;

/** Web-only: drop the browser focus outline (focus is drawn by the border). */
export const noOutline = { outlineStyle: 'none' } as unknown as TextStyle;

export const font = {
  regular: 'BeVietnamPro_400Regular',
  medium: 'BeVietnamPro_500Medium',
  bold: 'BeVietnamPro_600SemiBold',
  heavy: 'BeVietnamPro_700Bold',
} as const;

export const radius = { sm: 8, md: 12, lg: 18, xl: 24, full: 999 } as const;

/** Spacing scale; screens use these instead of ad-hoc numbers. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const shadow = {
  card: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

export type Tone = 'green' | 'orange' | 'blue' | 'purple' | 'red' | 'gray';
export const tone: Record<Tone, { fg: string; bg: string; deep: string }> = {
  green: { fg: color.green, bg: color.greenTint, deep: color.greenDeep },
  orange: { fg: color.orange, bg: color.orangeTint, deep: color.orangeDeep },
  blue: { fg: color.blue, bg: color.blueTint, deep: color.blueDeep },
  purple: { fg: color.purple, bg: color.purpleTint, deep: color.purpleDeep },
  red: { fg: color.red, bg: color.redTint, deep: color.redDeep },
  gray: { fg: color.muted, bg: '#f1f3f2', deep: color.inkSoft },
};
