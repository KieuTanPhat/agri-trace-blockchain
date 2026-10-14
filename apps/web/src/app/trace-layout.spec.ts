import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../styles/app.css"),
  "utf8",
);

function declarations(selector: string, media?: string) {
  const element = document.createElement("style");
  element.textContent = stylesheet;
  document.head.append(element);
  const rules = Array.from(element.sheet!.cssRules);
  const scope = media
    ? rules
        .filter((rule): rule is CSSMediaRule => rule.type === 4)
        .filter((rule) => rule.media.mediaText === media)
        .flatMap((rule) => Array.from(rule.cssRules))
    : rules;
  return scope
    .filter((rule): rule is CSSStyleRule => rule.type === 1)
    .filter((rule) =>
      rule.selectorText
        .split(",")
        .map((part) => part.trim())
        .includes(selector),
    )
    .map((rule) => rule.style);
}

afterEach(() => {
  document.head.querySelectorAll("style").forEach((element) => element.remove());
});

describe("public trace responsive hero", () => {
  it("stacks the photo and text on phones instead of shrinking the title beside the photo", () => {
    const header = declarations(".trace-page .trace-hero", "(max-width: 600px)");
    expect(
      header.some((style) => style.getPropertyValue("flex-direction") === "column"),
    ).toBe(true);
    expect(
      header.some((style) => style.getPropertyValue("align-items") === "stretch"),
    ).toBe(true);
    const photo = declarations(".trace-page .trace-product-photo", "(max-width: 600px)");
    expect(
      photo.some((style) => style.getPropertyValue("width") === "100%"),
    ).toBe(true);
    expect(
      photo.some((style) => style.getPropertyValue("height") === "160px"),
    ).toBe(true);
  });

  it.each([".trace-hero h1", ".trace-hero .muted"])(
    "wraps long product names and identifiers in %s",
    (selector) => {
      expect(
        declarations(selector).some(
          (style) => style.getPropertyValue("overflow-wrap") === "anywhere",
        ),
      ).toBe(true);
    },
  );
});
