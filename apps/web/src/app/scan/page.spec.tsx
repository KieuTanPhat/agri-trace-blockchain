import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ScanPage from "./page";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/qr-code-card", () => ({ QrCodeCard: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("opens a token through the form without requiring a mouse click", () => {
  render(<ScanPage />);
  fireEvent.change(screen.getByLabelText("Trace token hoặc đường dẫn"), {
    target: { value: "  public-token  " },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Tra cứu nông sản" }));
  expect(push).toHaveBeenCalledWith("/trace/public-token");
});

it("extracts the token from an old HTTP QR URL and navigates locally", () => {
  render(<ScanPage />);
  fireEvent.change(screen.getByLabelText("Trace token hoặc đường dẫn"), {
    target: { value: "http://13.140.170.166/trace/public-token" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Tra cứu nông sản" }));
  expect(push).toHaveBeenCalledWith("/trace/public-token");
});

it("shows an input error instead of opening a misleading URL route", () => {
  render(<ScanPage />);
  fireEvent.change(screen.getByLabelText("Trace token hoặc đường dẫn"), {
    target: { value: "https://agritrace.dev/admin/trace/token" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Tra cứu nông sản" }));
  expect(screen.getByRole("alert")).toHaveTextContent("hợp lệ");
  expect(push).not.toHaveBeenCalled();
});
