import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataForm } from "@/shared/ui/data-form";
import { request } from "@/shared/api/http-client";
vi.mock("@/shared/api/http-client", () => ({ request: vi.fn() }));
describe("DataForm retry", () => {
  beforeEach(() => vi.resetAllMocks());
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
});
