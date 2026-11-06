import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SepayPayment } from "./sepay-payment";

const state = vi.hoisted(() => ({
  data: {
    enabled: true,
    mode: "test",
    invoiceId: "invoice-1",
    invoiceNumber: "AGT-2026-000001",
    amount: 1000,
    status: "ISSUED",
    simulated: true,
    serviceActive: false,
    reviewMessage: null as string | null,
    gateway: {
      action: "https://pay-sandbox.sepay.vn/v1/checkout/init",
      fields: [
        { name: "order_amount", value: "1000" },
        { name: "signature", value: "signed-fixture" },
      ],
    },
  },
  invalidateQueries: vi.fn(),
}));
vi.mock("@/lib/ledger/data", () => ({
  useLedgerQuery: () => ({
    data: state.data,
    refetch: vi.fn(),
    isFetching: false,
  }),
  useLedgerQueryClient: () => ({ invalidateQueries: state.invalidateQueries }),
}));
afterEach(() => {
  cleanup();
  state.data.status = "ISSUED";
  state.data.reviewMessage = null;
  vi.clearAllMocks();
});

describe("SePay Gateway checkout", () => {
  it("posts the signed fields to Sandbox without showing success before IPN", () => {
    const paid = vi.fn();
    render(<SepayPayment onPaid={paid} />);
    const form = screen
      .getByRole("button", { name: "Thanh toán qua SePay" })
      .closest("form");
    expect(form).toHaveAttribute("method", "POST");
    expect(form).toHaveAttribute(
      "action",
      "https://pay-sandbox.sepay.vn/v1/checkout/init",
    );
    expect(form?.querySelector('input[name="order_amount"]')).toHaveValue(
      "1000",
    );
    expect(paid).not.toHaveBeenCalled();
    expect(screen.queryByText("Thanh toán thành công")).not.toBeInTheDocument();
  });
  it("stops offering payment when reconciliation is required", () => {
    state.data.reviewMessage = "Có giao dịch cần đối soát";
    render(<SepayPayment />);
    expect(
      screen.queryByRole("button", { name: "Thanh toán qua SePay" }),
    ).not.toBeInTheDocument();
  });
  it("only reports payment after the server says PAID", () => {
    state.data.status = "PAID";
    const paid = vi.fn();
    render(<SepayPayment onPaid={paid} />);
    expect(paid).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Thanh toán qua SePay" }),
    ).not.toBeInTheDocument();
  });
});
