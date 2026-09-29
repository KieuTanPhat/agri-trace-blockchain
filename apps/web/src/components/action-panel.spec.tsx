import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionPanel } from "./action-panel";
import { submitCommand } from "@/lib/api-client";
import type { LotTrace } from "@/lib/types";
vi.mock("@/lib/api-client", () => ({
  submitCommand: vi.fn(),
  getOrganizations: vi.fn(),
}));
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
});
