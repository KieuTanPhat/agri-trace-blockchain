import { describe, it, expect } from "vitest";
import { csvCell, queryString } from "./workspace-api";
import { validateFile } from "./media-api";
describe("CSV and media validation", () => {
  it("escapes quotes and neutralizes spreadsheet formulas", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("a,b\nc")).toBe('"a,b\nc"');
    expect(csvCell("  +1")).toBe('"\'  +1"');
  });
  it("preserves filters and omits empty values", () =>
    expect(queryString({ from: "", productId: "a b", page: 2 })).toBe(
      "productId=a+b&page=2",
    ));
  it("rejects unsupported, empty and oversized files", () => {
    expect(
      validateFile(new File(["x"], "x.svg", { type: "image/svg+xml" })),
    ).toContain("Chỉ hỗ trợ");
    expect(
      validateFile(new File([], "x.png", { type: "image/png" })),
    ).toContain("Dung lượng");
    expect(
      validateFile(
        new File([new Uint8Array(5242881)], "x.png", { type: "image/png" }),
      ),
    ).toContain("Dung lượng");
    expect(
      validateFile(new File(["data"], "x.pdf", { type: "application/pdf" })),
    ).toBe("");
  });
});
