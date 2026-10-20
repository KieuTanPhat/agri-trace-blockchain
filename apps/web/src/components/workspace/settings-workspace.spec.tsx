import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsWorkspace } from "./settings-workspace";
import { TEXT_ROLES, loadTypography } from "@/lib/typography";
import {
  appearanceCss,
  applyAppearance,
  loadAppearance,
  normalizeAppearance,
} from "@/lib/appearance";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("workspace settings", () => {
  it("previews without saving, cancels, then persists a chosen palette", () => {
    render(<SettingsWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Xanh dương" }));
    expect(screen.getByRole("button", { name: "Xanh dương" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(loadAppearance().theme).toBe("default");
    fireEvent.click(screen.getByRole("button", { name: "Hủy thay đổi" }));
    expect(
      within(screen.getByRole("group", { name: "Kiểu chủ đề" })).getByRole(
        "button",
        { name: "Mặc định", pressed: true },
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xanh dương" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    expect(loadAppearance()).toMatchObject({
      theme: "blue",
      primary: "#1d4ed8",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Đã lưu cài đặt");
  });

  it("retains all granular typography controls and saves them across tabs", () => {
    render(<SettingsWorkspace />);
    fireEvent.click(screen.getByRole("tab", { name: "Nâng cao" }));
    for (const role of TEXT_ROLES)
      expect(
        screen.getByLabelText(`Cỡ chữ cho ${role.label}`),
      ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cỡ chữ cho Tiêu đề trang"), {
      target: { value: "31" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Giao diện" }));
    fireEvent.click(screen.getByRole("button", { name: "Gọn" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    expect(loadTypography().roles.pageTitle.size).toBe(31);
    expect(loadAppearance().density).toBe("compact");
  });

  it("rejects stored CSS values outside the supported preference format", () => {
    const normalized = normalizeAppearance({
      primary: "red; } body { display:none",
      width: "invalid" as never,
    });
    expect(normalized.primary).toBe("#087a3f");
    expect(normalized.width).toBe("default");
    expect(appearanceCss(normalized)).not.toContain("display:none");
  });

  it("keeps all workspace content full-width with a saved default appearance", () => {
    localStorage.setItem(
      "agritrace:appearance:v1",
      JSON.stringify({ width: "default", theme: "blue", density: "compact" }),
    );
    const { container } = render(
      <div className="app-shell">
        <main className="content">
          <div className="page-content">Thêm thành viên</div>
        </main>
      </div>,
    );
    try {
      applyAppearance(loadAppearance());
      const content = container.querySelector(".page-content")!;
      expect(getComputedStyle(content).width).toBe("100%");
      expect(getComputedStyle(content).maxWidth).toBe("none");
      expect(getComputedStyle(content).marginInline).toBe("0");
    } finally {
      document.getElementById("agritrace-appearance")?.remove();
    }
  });
});
