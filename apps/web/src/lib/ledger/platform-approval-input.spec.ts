import { describe, it, expect } from "vitest";
import { parseApprovalProposal } from "./platform-approval-input";
const id = "11111111-1111-4111-8111-111111111111";
describe("baseline proposal inputs", () => {
  it("retains the exact versioned connection proposal without unrelated form values", () => {
    expect(
      parseApprovalProposal({
        operation: "CONNECTION_APPROVE",
        connectionId: id,
        version: "3",
        note: "Đã đối chiếu kết nối",
        reason: "Kiểm tra bởi người thứ hai",
        temporaryPassword: "unrelated-secret",
      }),
    ).toEqual({
      operation: "CONNECTION_APPROVE",
      params: { connectionId: id, version: 3, note: "Đã đối chiếu kết nối" },
      reason: "Kiểm tra bởi người thứ hai",
    });
  });
  it("preserves typed setting values and rejects malformed JSON and invalid versions", () => {
    expect(
      parseApprovalProposal({
        operation: "SETTING_CHANGE",
        key: "enrollment.slaHours",
        value: "24",
        version: "2",
        reason: "Điều chỉnh thời hạn xử lý",
      }).params,
    ).toEqual({ key: "enrollment.slaHours", value: 24, version: 2 });
    expect(() =>
      parseApprovalProposal({
        operation: "SETTING_CHANGE",
        key: "x",
        value: "{",
        version: 1,
        reason: "Điều chỉnh thời hạn xử lý",
      }),
    ).toThrow();
    expect(() =>
      parseApprovalProposal({
        operation: "INVOICE_CONFIRM_PAYMENT",
        invoiceId: id,
        version: -1,
        reference: "ref",
        reason: "Xác minh thanh toán",
      }),
    ).toThrow();
  });
  it("never sends a password for account creation and measures reset passwords in UTF8 bytes", () => {
    const value = {
      operation: "SYSTEM_ADMIN_CREATE",
      email: "test@example.invalid",
      fullName: "Nguyễn An",
      roleCode: "PLATFORM_OPERATOR",
      temporaryPassword: "excluded",
      reason: "Tạo tài khoản vận hành",
    };
    expect(parseApprovalProposal(value).params).toEqual({
      email: "test@example.invalid",
      fullName: "Nguyễn An",
      roleCode: "PLATFORM_OPERATOR",
    });
    expect(() =>
      parseApprovalProposal({
        operation: "ADMIN_PASSWORD_RESET",
        userId: id,
        temporaryPassword: "ệ".repeat(25),
        reason: "Đặt lại mật khẩu quản trị",
      }),
    ).toThrow();
  });
  it("supports every operation in the baseline input enum", () => {
    for (const input of [
      { operation: "CAPABILITY_GRANT", organizationId: id, code: "FARM" },
      { operation: "CREATE_CHAIN_GRANT", organizationId: id, userId: id },
      {
        operation: "CAPABILITY_REQUEST_APPROVE",
        requestId: id,
        version: 1,
        note: "Đã kiểm tra yêu cầu",
      },
      { operation: "PLAN_VERSION_PUBLISH", versionId: id },
      {
        operation: "QR_BLOCK",
        lotId: id,
        publicMessage: "Đang đối soát thông tin",
      },
    ])
      expect(
        parseApprovalProposal({ ...input, reason: "Đã đối chiếu thông tin" })
          .operation,
      ).toBe(input.operation);
  });
});
