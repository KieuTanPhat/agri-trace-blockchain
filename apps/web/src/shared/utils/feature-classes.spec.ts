import { describe, expect, it } from "vitest";
import { withFeatureClasses } from "./feature-classes";

describe("Feature CSS class mapping", () => {
  it("keeps global classes and adds only owned module classes", () => {
    expect(
      withFeatureClasses("panel proof-summary", {
        "proof-summary": "trace_proof-summary",
      }),
    ).toBe("panel proof-summary trace_proof-summary");
  });
  it("preserves optional and shared-only class names", () => {
    expect(withFeatureClasses(undefined, {})).toBeUndefined();
    expect(withFeatureClasses("panel", {})).toBe("panel");
  });
  it("maps dynamic state classes without mutating the module", () => {
    const styles = Object.freeze({
      "proof-summary": "trace_summary",
      "proof-pending": "trace_pending",
    });
    expect(withFeatureClasses(`proof-summary proof-${"pending"}`, styles)).toBe(
      "proof-summary proof-pending trace_summary trace_pending",
    );
  });
});
