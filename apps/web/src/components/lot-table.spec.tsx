import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { mockLots } from "@/lib/mock-api";
import { LotTable } from "./lot-table";

afterEach(cleanup);
it("resets pagination when filtering and keeps mobile and desktop records consistent", () => {
  const lots = Array.from({ length: 21 }, (_, index) => ({
    ...mockLots[0],
    lotId: String(index),
    lotCode: `LOT-${index}`,
    productName: index === 0 ? "Nông sản tìm riêng" : `Nông sản ${index}`,
  }));
  render(<LotTable lots={lots} />);
  fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
  expect(screen.getByRole("status")).toHaveTextContent("11 – 20 của 21");
  fireEvent.change(screen.getByLabelText("Tìm lô"), {
    target: { value: "tìm riêng" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("1 – 1 của 1");
  expect(screen.getAllByRole("link", { name: "Xem lô LOT-0" })).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Trang sau" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Tìm lô"), {
    target: { value: "không tồn tại" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("0 – 0 của 0");
});
