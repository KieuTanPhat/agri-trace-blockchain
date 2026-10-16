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
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("shipment retry", () => {
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
    vi.mocked(retryPendingCommand).mockResolvedValueOnce({
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
});
