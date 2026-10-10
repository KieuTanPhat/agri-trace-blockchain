import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HomePage from "./page";

vi.mock("next/image", () => ({ default: () => null }));
afterEach(cleanup);

it("presents general information and public scan navigation without demo QR or login links", () => {
  const { container } = render(<HomePage />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Mỗi nông sản",
  );
  const links = screen.getAllByRole("link");
  expect(links.some((link) => link.getAttribute("href") === "/scan")).toBe(
    true,
  );
  expect(
    links.some((link) =>
      /login|dashboard|nongtrace/.test(link.getAttribute("href") ?? ""),
    ),
  ).toBe(false);
  expect(container.textContent).not.toMatch(/demo|lô mẫu|dữ liệu minh họa/i);
  expect(container.querySelector(".real-qr")).toBeNull();
});

it("supports keyboard journey tabs and updates the related panel", () => {
  render(<HomePage />);
  const tab = screen.getByRole("tab", { name: "Canh tác" });
  fireEvent.keyDown(tab, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Thu hoạch" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tabpanel")).toHaveTextContent(
    "Mỗi lần thu hoạch, một lô riêng",
  );
});
