import { describe, it, expect } from "vitest";
import { temporaryPasswordSchema } from "./platform-approval-input";
describe("temporary administrator password", () => {
  it("counts UTF-8 bytes rather than characters", () => {
    expect(temporaryPasswordSchema.safeParse("a".repeat(12)).success).toBe(true);
    expect(temporaryPasswordSchema.safeParse("ệ".repeat(25)).success).toBe(false);
    expect(temporaryPasswordSchema.safeParse("a".repeat(11)).success).toBe(false);
  });
});
