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
    fireEvent.change(screen.getByLabelText("Tên *"), {
      target: { value: "Cà chua" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Tên *")).toHaveValue("Cà chua");
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ id: "created" }));
    expect(vi.mocked(request).mock.calls[0][1]).toEqual(
      vi.mocked(request).mock.calls[1][1],
    );
    expect(screen.getByLabelText("Tên *")).toHaveValue("");
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
