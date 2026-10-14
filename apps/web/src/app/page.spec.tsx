import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HomePage from "./page";
import { SITE_CONTACT } from "@/lib/site-contact";

vi.mock("next/image", () => ({ default: () => null }));
afterEach(cleanup);

it("presents general information and public scan navigation without demo QR or login links", () => {
  const { container } = render(<HomePage />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Biến dữ liệu nông trại thành truy xuất nguồn gốc",
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

it("offers email and Zalo contact channels from the shared contact module", () => {
  render(<HomePage />);
  const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
  expect(hrefs).toContain(SITE_CONTACT.emailUrl);
  expect(hrefs).toContain(SITE_CONTACT.zaloUrl);
});

it("lists the six steps of the journey in order", () => {
  render(<HomePage />);
  const steps = screen
    .getByRole("heading", { name: /Xây dựng truy xuất khi sản xuất diễn ra/ })
    .closest(".container")!
    .querySelectorAll(".lp-steps li h3");
  expect(Array.from(steps, (step) => step.textContent)).toEqual([
    "Đăng ký nguồn",
    "Ghi nhận sản xuất",
    "Kiểm định, chứng nhận",
    "Thu hoạch, tạo lô",
    "Vận chuyển, bàn giao",
    "Công khai truy xuất",
  ]);
});
