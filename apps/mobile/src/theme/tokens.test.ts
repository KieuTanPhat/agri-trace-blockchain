import { contrastRatio } from "./contrast";
import { COLOR_NAMES, palettes, radius, space, THEME_IDS, typography, type ColorName } from "./tokens";

// Pairs named by the usage notes in design/tokens.json. Text needs 4.5:1; borders, focus rings and icons 3:1.
const TEXT_PAIRS: [ColorName, ColorName][] = [
  ...(["ink", "ink-soft", "muted"] as const).flatMap((fg) =>
    (["bg", "surface", "cream", "surface-sunken"] as const).map((bg): [ColorName, ColorName] => [fg, bg]),
  ),
  ["on-primary", "primary"],
  ["on-primary", "primary-strong"],
  ["on-forest", "forest"],
  ["on-accent", "accent"],
  ["accent-ink", "bg"],
  ["accent-ink", "surface"],
  ["primary", "surface"],
  ["primary", "bg"],
  ["primary", "primary-soft"],
  ...(["success", "warning", "danger", "info", "neutral"] as const).map(
    (tone): [ColorName, ColorName] => [tone, `${tone}-bg` as ColorName],
  ),
];
const MARK_PAIRS: [ColorName, ColorName][] = [
  ["control-border", "surface"],
  ["subtle", "surface"],
  ["focus", "bg"],
  ["focus", "surface"],
  ["focus", "cream"],
];

describe("design tokens", () => {
  it.each(THEME_IDS)("resolves every color in the %s theme", (theme) => {
    for (const name of COLOR_NAMES) expect(palettes[theme][name]).toMatch(/^(#|rgba\()/);
  });

  it.each(THEME_IDS)("keeps text legible in the %s theme", (theme) => {
    const colors = palettes[theme];
    const failures = TEXT_PAIRS.filter(([fg, bg]) => contrastRatio(colors[fg], colors[bg]) < 4.5);
    expect(failures).toEqual([]);
  });

  it.each(THEME_IDS)("keeps borders and focus rings visible in the %s theme", (theme) => {
    const colors = palettes[theme];
    const failures = MARK_PAIRS.filter(([fg, bg]) => contrastRatio(colors[fg], colors[bg]) < 3);
    expect(failures).toEqual([]);
  });

  it("holds primary text in the outdoor theme to 7:1", () => {
    const colors = palettes.outdoor;
    for (const bg of ["bg", "surface", "cream"] as const) {
      expect(contrastRatio(colors.ink, colors[bg])).toBeGreaterThanOrEqual(7);
    }
  });

  it("exposes touch targets and type scale from the token file", () => {
    expect(space.touchMin).toBe(48);
    expect(space.touchField).toBe(56);
    expect(radius.full).toBe(999);
    expect(typography.body).toMatchObject({ fontFamily: "BeVietnamPro-Regular", fontSize: 16, lineHeight: 24 });
    expect(typography.display.fontFamily).toBe("BeVietnamPro-ExtraBold");
  });
});
