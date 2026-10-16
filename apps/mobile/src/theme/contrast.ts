/** WCAG 2 contrast ratio between two opaque hex colors (#rgb or #rrggbb). */
export function contrastRatio(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x) as [number, number];
  return (a + 0.05) / (b + 0.05);
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) throw new Error(`Expected an opaque hex color, got ${hex}`);
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(digits.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
