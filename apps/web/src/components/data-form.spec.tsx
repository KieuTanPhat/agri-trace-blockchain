import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataForm } from "./data-form";
import { request, retryPendingCommand } from "@/lib/api-client";
vi.mock("@/lib/api-client", () => ({
  request: vi.fn(),
  retryPendingCommand: vi.fn(),
}));
describe("DataForm retry", () => {
  it("freezes an uncertain case body and preserves its key even when the version prop refreshes", async () => {
    vi.mocked(request)
      .mockRejectedValueOnce({ status: 503, message: "Kết quả chưa rõ" })
      .mockResolvedValueOnce({ id: "case" });
    const saved = vi.fn();
    const view = render(
      <DataForm
        freezeOnUnknown
        title="Giao hồ sơ"
        path="/platform-cases/case/assign"
        extra={{ version: 0 }}
        fields={[{ name: "note", label: "Ghi chú" }]}
        onSaved={saved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Ghi chú"), {
      target: { value: "Nội dung ban đầu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Giao hồ sơ" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Ghi chú")).toBeDisabled();
    view.rerender(
      <DataForm
        freezeOnUnknown
        title="Giao hồ sơ"
        path="/platform-cases/case/assign"
        extra={{ version: 1 }}
        fields={[{ name: "note", label: "Ghi chú" }]}
        onSaved={saved}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Thử lại yêu cầu ban đầu" }),
    );
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ id: "case" }));
    expect(vi.mocked(request).mock.calls[1][1]).toEqual(
      vi.mocked(request).mock.calls[0][1],
    );
  });
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());
  it("keeps input and request identity after a lost response, and clears only on success", async () => {
    vi.mocked(request)
      .mockRejectedValueOnce({ message: "Mất kết nối" })
      .mockResolvedValueOnce({ id: "created" });
    const saved = vi.fn();
    render(
      <DataForm
        title="Tạo"
        path="/catalog/products"
        fields={[{ name: "productName", label: "Tên", required: true }]}
        onSaved={saved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Tên"), {
      target: { value: "Cà chua" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Tên")).toHaveValue("Cà chua");
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ id: "created" }));
    expect(vi.mocked(request).mock.calls[0][1]).toEqual(
      vi.mocked(request).mock.calls[1][1],
    );
    expect(screen.getByLabelText("Tên")).toHaveValue("");
  });
  it("recovers the saved original request while preserving changed input until the outcome is known", async () => {
    vi.mocked(request).mockRejectedValueOnce({
      message: "Mất kết nối",
      recoveryId: "saved-intent",
    });
    vi.mocked(retryPendingCommand)
      .mockRejectedValueOnce({
        message: "Đang đối soát",
        recoveryId: "saved-intent",
      })
      .mockResolvedValueOnce({ id: "original-result" });
    const saved = vi.fn();
    render(
      <DataForm
        title="Tạo"
        path="/supply-chains"
        fields={[{ name: "name", label: "Tên" }]}
        onSaved={saved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Tên"), {
      target: { value: "Ban đầu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("Tên"), {
      target: { value: "Nội dung mới" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Kiểm tra và thử lại yêu cầu trước" }),
    );
    await screen.findByText("Đang đối soát");
    expect(screen.getByLabelText("Tên")).toHaveValue("Nội dung mới");
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Kiểm tra và thử lại yêu cầu trước" }),
    );
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({ id: "original-result" }),
    );
    expect(retryPendingCommand).toHaveBeenNthCalledWith(1, "saved-intent");
    expect(retryPendingCommand).toHaveBeenNthCalledWith(2, "saved-intent");
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Tên")).toHaveValue("");
  });
  it("creates a new identity for unchanged input only after an explicit known-rejection restart", async () => {
    vi.mocked(request).mockRejectedValue({
      message: "Đã từ chối",
      canRestart: true,
    });
    const saved = vi.fn();
    render(
      <DataForm
        title="Tạo"
        path="/supply-chains"
        fields={[{ name: "name", label: "Tên" }]}
        onSaved={saved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Tên"), {
      target: { value: "Chuỗi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(vi.mocked(request).mock.calls[1][1]).toEqual(
      vi.mocked(request).mock.calls[0][1],
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Chuẩn bị yêu cầu mới" }),
    );
    vi.mocked(request).mockResolvedValueOnce({ id: "new-result" });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({ id: "new-result" }),
    );
    expect(vi.mocked(request).mock.calls[2][1]?.headers).not.toEqual(
      vi.mocked(request).mock.calls[0][1]?.headers,
    );
    expect(vi.mocked(request).mock.calls[2][1]?.body).toBe(
      vi.mocked(request).mock.calls[0][1]?.body,
    );
  });
});

describe("DataForm governance fields", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());
  it("nests fields under their group, merges with nested extras and sends headers outside the body", async () => {
    vi.mocked(request).mockResolvedValueOnce({ id: "proposal" });
    const saved = vi.fn();
    render(
      <DataForm
        title="Gửi đề xuất"
        path="/platform-approvals"
        extra={{
          operation: "CONNECTION_APPROVE",
          params: { connectionId: "c1", version: 2 },
        }}
        fields={[
          { name: "note", label: "Căn cứ", required: true, nest: "params" },
          { name: "reason", label: "Lý do", required: true },
          { name: "mfaCode", label: "Mã MFA", header: "X-MFA-Code" },
        ]}
        onSaved={saved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Căn cứ"), {
      target: { value: "Đã đối chiếu chứng thư" },
    });
    fireEvent.change(screen.getByLabelText("Lý do"), {
      target: { value: "Doanh nghiệp đã đủ hồ sơ" },
    });
    fireEvent.change(screen.getByLabelText("Mã MFA"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi đề xuất" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ id: "proposal" }));
    const [, init] = vi.mocked(request).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      operation: "CONNECTION_APPROVE",
      params: {
        connectionId: "c1",
        version: 2,
        note: "Đã đối chiếu chứng thư",
      },
      reason: "Doanh nghiệp đã đủ hồ sơ",
    });
    expect(String(init?.body)).not.toContain("123456");
    expect(init?.headers).toMatchObject({ "X-MFA-Code": "123456" });
    expect(
      (init?.headers as Record<string, string>)["idempotency-key"],
    ).toBeTruthy();
  });
});
