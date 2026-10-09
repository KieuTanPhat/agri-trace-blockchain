import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-store";
import { getProfile } from "./api-client";
vi.mock("./api-client", () => ({
  AUTH_STORAGE_KEY: "agritrace-auth",
  getProfile: vi.fn(),
  login: vi.fn(),
  revokeSession: vi.fn(),
}));
const user = {
  id: "u",
  email: "user@example.com",
  fullName: "Người dùng",
  organizationId: null,
  role: { code: "SYSTEM_ADMIN" as const, name: "Quản trị" },
  accountStatus: "ACTIVE",
};
function Probe() {
  const auth = useAuth();
  return (
    <p>
      {auth.isLoading ? "Đang tải" : (auth.user?.fullName ?? "Chưa đăng nhập")}
    </p>
  );
}
describe("session restoration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem(
      "agritrace-auth",
      JSON.stringify({ accessToken: "old", refreshToken: "old-refresh", user }),
    );
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });
  it("does not overwrite rotated tokens with the snapshot from page load", async () => {
    vi.mocked(getProfile).mockImplementation(async () => {
      localStorage.setItem(
        "agritrace-auth",
        JSON.stringify({
          accessToken: "new",
          refreshToken: "new-refresh",
          user,
        }),
      );
      return user;
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("Người dùng");
    expect(
      JSON.parse(localStorage.getItem("agritrace-auth")!).refreshToken,
    ).toBe("new-refresh");
  });
  it("updates its user after a same-tab refresh notification", async () => {
    vi.mocked(getProfile).mockResolvedValue(user);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("Người dùng");
    await act(async () => {
      localStorage.setItem(
        "agritrace-auth",
        JSON.stringify({
          accessToken: "new",
          refreshToken: "rotated",
          user: { ...user, fullName: "Updated role" },
        }),
      );
      window.dispatchEvent(new Event("auth-changed"));
    });
    expect(screen.getByText("Updated role")).toBeInTheDocument();
  });

  it("keeps a saved session after a temporary profile failure", async () => {
    vi.mocked(getProfile).mockRejectedValue({ status: 503 });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("Người dùng")).toBeInTheDocument(),
    );
    expect(localStorage.getItem("agritrace-auth")).not.toBeNull();
  });
  it("does not replace a new user's profile with a late response from the old session", async () => {
    let resolveProfile!: (profile: typeof user) => void;
    vi.mocked(getProfile).mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      }),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    const otherUser = { ...user, id: "other", fullName: "Other user" };
    await act(async () => {
      localStorage.setItem(
        "agritrace-auth",
        JSON.stringify({
          accessToken: "other-token",
          refreshToken: "other-refresh",
          user: otherUser,
        }),
      );
      window.dispatchEvent(new Event("auth-changed"));
      resolveProfile(user);
    });
    await screen.findByText("Other user");
    expect(JSON.parse(localStorage.getItem("agritrace-auth")!).user.id).toBe(
      "other",
    );
  });
});
