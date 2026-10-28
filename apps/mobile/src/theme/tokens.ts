import type { TextStyle } from 'react-native';

/**
 * Mobile palette from the approved canvas (iCheck/VNeCheck-style): solid green
 * header, white raised cards, multi-colour icon tiles, orange highlights.
 * Brand greens follow apps/web/src/styles/tokens.css.
 */
export const color = {
  bg: '#f2f5f8',
  surface: '#ffffff',
  ink: '#1f2a37',
  inkSoft: '#3d4756',
  muted: '#5b6675',
  faint: '#8a94a3',
  line: '#e3e8ee',
  field: '#d3dae2',
  green: '#239b45',
  greenDeep: '#1b7a37',
  greenTint: '#e7f6ea',
  teal: '#1d8a6a',
  orange: '#f58a00',
  orangeDeep: '#c25f00',
  orangeTint: '#fff1de',
  blue: '#2f6fde',
  blueDeep: '#1f55b8',
  blueTint: '#e6f0ff',
  purple: '#7c4ddb',
  purpleDeep: '#5b2fb8',
  purpleTint: '#f1e9ff',
  red: '#e5483b',
  redDeep: '#c0281c',
  redTint: '#fdecec',
  warn: '#6b4300',
  warnBg: '#fff6e0',
  warnLine: '#f6d58a',
} as const;

/** Web-only: drop the browser focus outline (focus is drawn by the border). */
export const noOutline = { outlineStyle: 'none' } as unknown as TextStyle;

export const font = {
  regular: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  heavy: 'Nunito_800ExtraBold',
} as const;

export const radius = { sm: 10, md: 14, lg: 16, xl: 28, full: 999 } as const;

export const shadow = {
  card: {
    shadowColor: '#101828',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#101828',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
} as const;

export type Tone = 'green' | 'orange' | 'blue' | 'purple' | 'red';
export const tone: Record<Tone, { fg: string; bg: string; deep: string }> = {
  green: { fg: color.green, bg: color.greenTint, deep: color.greenDeep },
  orange: { fg: color.orange, bg: color.orangeTint, deep: color.orangeDeep },
  blue: { fg: color.blue, bg: color.blueTint, deep: color.blueDeep },
  purple: { fg: color.purple, bg: color.purpleTint, deep: color.purpleDeep },
  red: { fg: color.red, bg: color.redTint, deep: color.redDeep },
};
