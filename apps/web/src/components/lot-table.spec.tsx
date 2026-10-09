import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockLots } from "@/lib/mock-api";
import type { LotTrace } from "@/lib/types";
import { LotTable } from "./lot-table";

vi.mock("next/image", () => ({ default: () => null }));
afterEach(cleanup);

const lots: LotTrace[] = Array.from({ length: 21 }, (_, index) => ({
  ...mockLots[0],
  lotId: `lot-${index}`,
  lotCode: `LOT-${String(index).padStart(3, "0")}`,
  currentState: index === 0 ? "ARRIVED" : "HARVESTED",
  farmOrg: { ...mockLots[0].farmOrg, organizationId: index === 0 ? "first-farm" : "other-farm" },
}));

function goToLastPage() {
  fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
  fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
  expect(screen.getByText("LOT-020")).toBeInTheDocument();
}

describe("lot list pagination", () => {
  it.each(["search", "state", "farm", "stat"])("returns to the first page after a %s filter", (filter) => {
    render(<LotTable lots={lots} />);
    goToLastPage();
    if (filter === "search") fireEvent.change(screen.getByRole("textbox", { name: "Tìm lô" }), { target: { value: "LOT-000" } });
    if (filter === "state") fireEvent.change(screen.getByRole("combobox", { name: "Lọc trạng thái" }), { target: { value: "ARRIVED" } });
    if (filter === "farm") fireEvent.change(screen.getByRole("combobox", { name: "Lọc trang trại" }), { target: { value: "first-farm" } });
    if (filter === "stat") fireEvent.click(screen.getByRole("button", { name: /Đã đến điểm nhận/ }));
    expect(screen.getByText("LOT-000")).toBeInTheDocument();
    expect(screen.getByText("Hiển thị 1 – 1 của 1 lô nông sản")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Xem chi tiết lô LOT-000" })).toHaveAttribute("href", "/lots/lot-0");
  });

  it("keeps a valid page when refreshed data has fewer lots", () => {
    const view = render(<LotTable lots={lots} />);
    goToLastPage();
    view.rerender(<LotTable lots={lots.slice(0, 2)} />);
    expect(screen.getByText("LOT-000")).toBeInTheDocument();
    expect(screen.getByText("Hiển thị 1 – 2 của 2 lô nông sản")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeDisabled();
  });
});
