import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LoginPage from "./page";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

it.each([
  "",
  "?next=/",
  "?next=//external.example",
  "?next=%2F%5Cexternal.example",
  "?next=/login?next=/lots",
])("defaults to the protected overview for %s", async (search) => {
  window.history.replaceState({}, "", "/login" + search);
  render(<LoginPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
});

it("preserves a valid protected return route", async () => {
  window.history.replaceState({}, "", "/login?next=/lots/lot-1");
  render(<LoginPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/lots/lot-1"));
});
