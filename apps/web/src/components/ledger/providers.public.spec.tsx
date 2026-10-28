import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { clearSession, setSession, readSession } from "@/lib/api-client";
import { actorA, actorB } from "@/test/ledger-actors";
import Invitation from "@/features/ledger/screens/join-organization/screen";
import { LedgerProviders } from "./providers";
vi.mock("next/navigation", () => ({
  usePathname: () => "/join-organization",
  useRouter: () => ({ replace: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  clearSession(false);
  vi.unstubAllGlobals();
});
it("keeps an uncertain public invitation in memory across an unrelated authenticated identity change", async () => {
  localStorage.clear();
  sessionStorage.clear();
  clearSession(false);
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
  const attempts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/auth/refresh"))
        return Response.json({ success: true, data: actorA });
      if (path.endsWith("/chain-permissions"))
        return Response.json({
          success: true,
          data: {
            accessRevision: (readSession()?.user.id === actorA.user.id
              ? "a"
              : "b"
            ).repeat(64),
            productionChains: [],
          },
        });
      if (path.endsWith("/auth/member-invitations/accept")) {
        attempts.push(String(init?.body));
        if (attempts.length === 1) throw new TypeError("response lost");
        return Response.json({
          success: true,
          data: { record: { accepted: true } },
        });
      }
      throw new Error(`Unexpected invitation endpoint ${path}`);
    }),
  );
  const password = "Fixture-invitation-2026!",
    token = "a".repeat(43);
  render(
    <LedgerProviders>
      <Invitation
        route={{
          params: {},
          searchParams: { id: "11111111-1111-4111-8111-111111111111", token },
        }}
      />
    </LedgerProviders>,
  );
  fireEvent.change(screen.getByLabelText("Mật khẩu", { exact: true }), {
    target: { value: password },
  });
  fireEvent.change(
    screen.getByLabelText("Nhập lại mật khẩu", { exact: true }),
    { target: { value: password } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Kích hoạt tài khoản" }));
  await screen.findByRole("button", { name: "Đối soát" });
  const input = screen.getByLabelText("Mật khẩu", { exact: true });
  act(() => setSession(actorB));
  expect(screen.getByLabelText("Mật khẩu", { exact: true })).toBe(input);
  expect(input).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Đối soát" }));
  await waitFor(() =>
    expect(
      screen.getByText("Tài khoản đã được kích hoạt", { exact: true }),
    ).toBeVisible(),
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toBe(attempts[0]);
  expect(JSON.stringify(Object.values(localStorage))).not.toContain(password);
  expect(JSON.stringify(Object.values(localStorage))).not.toContain(token);
  expect(sessionStorage.length).toBe(0);
});
