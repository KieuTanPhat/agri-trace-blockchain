import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-store";
import { readSession, restoreSession } from "./api-client";

vi.mock("./api-client", () => ({
  AUTH_STORAGE_KEY: "agritrace-auth",
  readSession: vi.fn(),
  restoreSession: vi.fn(),
  clearSession: vi.fn(),
  login: vi.fn(),
  revokeSession: vi.fn(),
}));

const user = {
  id: "user-1",
  email: "staff@example.com",
  fullName: "Staff",
  organizationId: null,
  role: { code: "SYSTEM_ADMIN" as const, name: "Admin" },
  accountStatus: "ACTIVE",
};

function Probe() {
  const auth = useAuth();
  return <p>{auth.isLoading ? "Đang tải" : (auth.user?.fullName ?? "Chưa đăng nhập")}</p>;
}

describe("cookie session restoration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem("agritrace-auth", JSON.stringify({ refreshToken: "old" }));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("removes legacy stored tokens and restores the cookie session", async () => {
    vi.mocked(restoreSession).mockResolvedValue({ accessToken: "new", tokenType: "Bearer", user });
    vi.mocked(readSession).mockReturnValue({ accessToken: "new", tokenType: "Bearer", user });
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText("Staff");
    expect(localStorage.getItem("agritrace-auth")).toBeNull();
  });

  it("shows a signed-out state when refresh fails", async () => {
    vi.mocked(restoreSession).mockRejectedValue({ status: 401 });
    vi.mocked(readSession).mockReturnValue(null);
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText("Chưa đăng nhập");
  });

  it("updates the visible account on session changes", async () => {
    vi.mocked(restoreSession).mockRejectedValue({ status: 401 });
    vi.mocked(readSession).mockReturnValue(null);
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText("Chưa đăng nhập");
    vi.mocked(readSession).mockReturnValue({ accessToken: "new", tokenType: "Bearer", user });
    act(() => window.dispatchEvent(new Event("auth-changed")));
    await screen.findByText("Staff");
  });
});
