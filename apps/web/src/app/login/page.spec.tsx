import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import LedgerLoginScreen from '@/features/ledger/screens/login/screen';
const LoginPage=()=> <LedgerLoginScreen route={{params:{},searchParams:Object.fromEntries(new URLSearchParams(window.location.search))}}/>;

const { replace, authState, farmStaff } = vi.hoisted(() => {
  const farmStaff = () => ({ role: { code: "FARM_STAFF" }, organizationId: "org-1" });
  return {
    replace: vi.fn(),
    farmStaff,
    authState: {
      isLoading: false,
      isAuthenticated: true,
      user: farmStaff() as { role: { code: string }; organizationId?: string },
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => authState,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  authState.isLoading = false;
  authState.isAuthenticated = true;
  authState.user = farmStaff();
});

it("disables the server-rendered form until hydration installs its handlers", () => {
  const document = new DOMParser().parseFromString(renderToString(<LoginPage />), "text/html");
  expect(document.querySelectorAll("input:disabled")).toHaveLength(2);
  expect(document.querySelector("button[type=submit]")?.hasAttribute("disabled")).toBe(true);
});

it("waits for session restoration before enabling login", async () => {
  authState.isAuthenticated = false;
  authState.isLoading = true;
  const screen = render(<LoginPage />);
  expect(screen.getByLabelText("Email", { exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: /^Đăng nhập$/ })).toBeDisabled();
  authState.isLoading = false;
  screen.rerender(<LoginPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: /^Đăng nhập$/ })).toBeEnabled());
  expect(screen.getByLabelText("Mật khẩu", { exact: true })).toBeEnabled();
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
it('opens the system manager for a platform admin whose previous route belongs to enterprise onboarding',async()=>{
  authState.user={role:{code:'SYSTEM_ADMIN'}};
  window.history.replaceState({},'', '/login?next=/enterprise/onboarding');
  render(<LoginPage/>);
  await waitFor(()=>expect(replace).toHaveBeenCalledWith('/admin'));
});
it("ignores a return route left by another role and opens this role's home", async () => {
  authState.user = { role: { code: "AUDITOR" }, organizationId: "org-1" };
  window.history.replaceState({}, "", "/login?next=/enterprise/products");
  render(<LoginPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
});
it("sends an enterprise member away from a platform-only return route", async () => {
  window.history.replaceState({}, "", "/login?next=/admin/users");
  render(<LoginPage />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/enterprise"));
});
