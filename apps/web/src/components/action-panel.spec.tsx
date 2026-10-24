import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionPanel } from "./action-panel";
import { submitCommand, retryPendingCommand } from "@/lib/api-client";
import type { LotTrace } from "@/lib/types";
vi.mock("@/lib/api-client", () => ({
  submitCommand: vi.fn(),
  getOrganizations: vi.fn(),
  retryPendingCommand: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("shipment retry", () => {
  const saleLot = {
    lotId: "lot",
    lotCode: "LOT",
    version: 7,
    availableQuantity: 50,
    unit: "kg",
    allowedCommands: ["markSold"],
  } as LotTrace;

  it("keeps recovery reachable after reload removes every allowed command", async () => {
    vi.mocked(submitCommand).mockRejectedValue({
      recoveryId: "sale",
      message: "Mất phản hồi",
    });
    vi.mocked(retryPendingCommand).mockResolvedValue({});
    const done = vi.fn();
    const { container, rerender } = render(
      <ActionPanel lot={saleLot} onCompleted={done} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Bán toàn bộ/ }));
    fireEvent.submit(container.querySelector("form")!);
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Tải lại lô để kiểm tra" }),
    );
    rerender(
      <ActionPanel
        lot={{ ...saleLot, version: 8, allowedCommands: [] }}
        onCompleted={done}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Xem yêu cầu đang chờ" }),
    );
    expect(container.querySelector("dialog")).toHaveAttribute("open");
    fireEvent.click(
      screen.getByRole("button", { name: "Kiểm tra và thử lại yêu cầu trước" }),
    );
    await waitFor(() => expect(done).toHaveBeenCalledTimes(2));
    expect(retryPendingCommand).toHaveBeenCalledWith("sale");
    expect(submitCommand).toHaveBeenCalledTimes(1);
  });

  it("requests a page reload when another tab has settled the command", async () => {
    vi.mocked(submitCommand).mockRejectedValue({
      recoveryId: "sale",
      message: "Mất phản hồi",
    });
    vi.mocked(retryPendingCommand).mockRejectedValue({
      code: "RECOVERY_REFRESH",
      status: 409,
      message: "Tải lại kết quả",
    });
    const { container } = render(<ActionPanel lot={saleLot} />);
    fireEvent.click(screen.getByRole("button", { name: /Bán toàn bộ/ }));
    fireEvent.submit(container.querySelector("form")!);
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Kiểm tra và thử lại yêu cầu trước" }),
    );
    expect(
      await screen.findByRole("button", { name: "Tải lại trang để đồng bộ" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Kiểm tra và thử lại yêu cầu trước" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Xác nhận" })).toBeDisabled();
    expect(submitCommand).toHaveBeenCalledTimes(1);
  });

  it("blocks submits during refresh and sends the refreshed versions afterwards", async () => {
    vi.mocked(submitCommand).mockResolvedValue({ message: "Đã ghi nhận" });
    const { container, rerender } = render(<ActionPanel lot={saleLot} />);
    fireEvent.click(screen.getByRole("button", { name: /Bán toàn bộ/ }));
    rerender(<ActionPanel lot={saleLot} refreshing />);
    fireEvent.submit(container.querySelector("form")!);
    expect(submitCommand).not.toHaveBeenCalled();
    const refreshed = {
      ...saleLot,
      version: 8,
      shipment: { version: 12 },
    } as LotTrace;
    rerender(<ActionPanel lot={refreshed} />);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() =>
      expect(submitCommand).toHaveBeenCalledWith(
        refreshed,
        "markSold",
        {},
        expect.any(String),
      ),
    );
  });
  it("keeps the dialog and damage details after failure and reuses the request key", async () => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    vi.mocked(submitCommand)
      .mockRejectedValueOnce({ message: "Không kết nối được" })
      .mockResolvedValueOnce({ message: "Đã ghi nhận" });
    const done = vi.fn();
    const { container } = render(
      <ActionPanel
        lot={
          {
            lotId: "lot",
            lotCode: "LOT-1",
            version: 1,
            availableQuantity: 50,
            unit: "kg",
            allowedCommands: ["reportDamage"],
          } as LotTrace
        }
        onCompleted={done}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Báo hỏng/ }));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Dập khi vận chuyển" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await screen.findByRole("alert");
    expect(container.querySelector("dialog")).toHaveAttribute("open");
    expect(screen.getByRole("spinbutton")).toHaveValue(5);
    expect(screen.getByRole("textbox")).toHaveValue("Dập khi vận chuyển");
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(vi.mocked(submitCommand).mock.calls[0][3]).toBe(
      vi.mocked(submitCommand).mock.calls[1][3],
    );
    expect(container.querySelector("dialog")).not.toHaveAttribute("open");
  });
  it("offers recovery inside the modal and closes it only after the original outcome is confirmed", async () => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    vi.mocked(submitCommand).mockRejectedValueOnce({
      message: "Mất phản hồi",
      recoveryId: "damage-intent",
    });
    vi.mocked(retryPendingCommand)
      .mockRejectedValueOnce({
        status: 403,
        message: "Không đọc được trạng thái",
      })
      .mockResolvedValueOnce({
        message: "Đã ghi nhận",
      });
    const done = vi.fn();
    const { container } = render(
      <ActionPanel
        lot={
          {
            lotId: "lot",
            lotCode: "LOT-1",
            version: 1,
            availableQuantity: 50,
            unit: "kg",
            allowedCommands: ["reportDamage"],
          } as LotTrace
        }
        onCompleted={done}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Báo hỏng/ }));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Dập" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await screen.findByRole("alert");
    const modal = container.querySelector("dialog")!;
    expect(screen.getByRole("spinbutton")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Xác nhận" })).toBeDisabled();
    fireEvent.submit(modal.querySelector("form")!);
    expect(submitCommand).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    fireEvent.click(screen.getByRole("button", { name: /Báo hỏng/ }));
    expect(screen.getByRole("spinbutton")).toHaveValue(5);
    fireEvent.click(
      within(modal).getByRole("button", {
        name: "Kiểm tra và thử lại yêu cầu trước",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Không đọc được trạng thái",
      ),
    );
    expect(screen.getByRole("spinbutton")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Xác nhận" })).toBeDisabled();
    fireEvent.click(
      within(modal).getByRole("button", {
        name: "Kiểm tra và thử lại yêu cầu trước",
      }),
    );
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(retryPendingCommand).toHaveBeenCalledWith("damage-intent");
    expect(modal).not.toHaveAttribute("open");
    expect(submitCommand).toHaveBeenCalledTimes(1);
  });
  it("blocks a second submit while the first request is in flight", async () => {
    let complete!: (value: { message: string }) => void;
    vi.mocked(submitCommand).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const done = vi.fn();
    const { container } = render(
      <ActionPanel
        lot={
          {
            lotId: "lot",
            lotCode: "LOT",
            version: 7,
            availableQuantity: 50,
            unit: "kg",
            allowedCommands: ["markSold"],
          } as LotTrace
        }
        onCompleted={done}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Bán toàn bộ/ }));
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(submitCommand).toHaveBeenCalledTimes(1);
    complete({ message: "Đã ghi nhận" });
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  });
  it("uses only backend commands and blocks a revoked action in an open dialog", () => {
    const lot = {
      lotId: "lot",
      lotCode: "LOT",
      version: 7,
      availableQuantity: 50,
      unit: "kg",
      allowedCommands: ["markSold"],
    } as LotTrace;
    const { container, rerender } = render(<ActionPanel lot={lot} />);
    expect(
      screen.queryByRole("button", { name: /Báo hỏng/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Bán toàn bộ/ }));
    rerender(<ActionPanel lot={{ ...lot, allowedCommands: [] }} />);
    fireEvent.submit(container.querySelector("form")!);
    expect(submitCommand).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("403");
  });
  it.each([403, 409, 422])(
    "shows HTTP %s without losing the form",
    async (status) => {
      vi.mocked(submitCommand).mockRejectedValue({
        status,
        message: "Máy chủ từ chối",
        recoveryId: "pending",
      });
      const { container } = render(
        <ActionPanel
          lot={
            {
              lotId: "lot",
              lotCode: "LOT",
              version: 7,
              availableQuantity: 50,
              unit: "kg",
              allowedCommands: ["markSold"],
            } as LotTrace
          }
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /Bán toàn bộ/ }));
      fireEvent.submit(container.querySelector("form")!);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        String(status),
      );
      expect(container.querySelector("dialog")).toHaveAttribute("open");
    },
  );
});
