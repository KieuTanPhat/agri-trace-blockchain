/** Preserve shared selectors while feature rules use CSS Module classes. */
export function withFeatureClasses(
  className: string | undefined,
  ...modules: Readonly<Record<string, string>>[]
): string | undefined {
  if (className === undefined) return undefined;
  const scoped = className
    .split(/\s+/)
    .flatMap((name) => modules.map((styles) => styles[name]).filter(Boolean));
  return scoped.length ? [className, ...scoped].join(" ") : className;
}
