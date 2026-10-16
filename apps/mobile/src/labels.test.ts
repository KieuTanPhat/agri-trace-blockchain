import { formatDate, formatQuantity, lotState, proofStatus, warningMessage } from "./labels";

describe("labels", () => {
  it("formats quantities the Vietnamese way", () => {
    expect(formatQuantity(1240, "kg")).toBe("1.240 kg");
    expect(formatQuantity(1.8, "ha")).toBe("1,8 ha");
    expect(formatQuantity(5000000, "kg")).toBe("5.000.000 kg");
  });

  it("formats calendar dates as dd/mm/yyyy", () => {
    expect(formatDate("2026-10-14")).toMatch(/^1[34]\/10\/2026$/);
    expect(formatDate("not a date")).toBe("not a date");
  });

  it("never presents a proof as a quality certificate", () => {
    expect(proofStatus("VERIFIED").label).toBe("Đã khớp bằng chứng");
    expect(proofStatus("VERIFIED").description).not.toMatch(/chất lượng|an toàn|chứng nhận/i);
    expect(proofStatus("INTEGRITY_WARNING").tone).toBe("danger");
  });

  it("keeps recall wording independent of proof status", () => {
    expect(lotState("RECALLED").tone).toBe("danger");
    const lot = { expiryDate: null, sensorEvidence: { lateReadingCount: 2 } } as Parameters<typeof warningMessage>[1];
    expect(warningMessage("RECALLED", lot)).toContain("thu hồi");
    expect(warningMessage("LATE_READINGS", lot)).toContain("Có 2 mẫu");
    expect(warningMessage("UNKNOWN_CODE", lot)).toBeNull();
  });
});
