import { webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { clearSession, setSession } from "@/lib/api-client";
import { ledgerRequest } from "@/lib/ledger/request";
import { actorA } from "@/test/ledger-actors";
import { installBrowserLocks } from "@/test/browser-locks";
import { LedgerProviders } from "./providers";
vi.mock("next/navigation", () => ({
  usePathname: () => "/enterprise",
  useRouter: () => ({ replace: vi.fn() }),
}));
const modules = import.meta.glob<{
  LedgerRecoveryPanel: () => React.ReactNode;
}>("./command-recovery.tsx", { eager: true });
afterEach(() => {
  cleanup();
  clearSession(false);
  vi.unstubAllGlobals();
});
it("recovers the existing baseline journal after remount without exposing payloads or resending COMMITTED", async () => {
  const restore = installBrowserLocks();
  vi.stubGlobal("crypto", webcrypto);
  localStorage.clear();
  setSession(actorA);
  let sends = 0;
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/refresh"))
        return Response.json({ success: true, data: actorA });
      if (path.endsWith("/chain-permissions"))
        return Response.json({
          success: true,
          data: { accessRevision: "a".repeat(64), productionChains: [] },
        });
      if (path.endsWith("/command-requests/status"))
        return Response.json({
          success: true,
          data: {
            status: "COMMITTED",
            responseStatus: 201,
            result: { id: "created" },
          },
        });
      if (path.endsWith("/supply-chains")) {
        sends++;
        throw new TypeError("response lost");
      }
      throw new Error(`Unexpected recovery endpoint ${path}`);
    }),
  );
  try {
    await ledgerRequest("/supply-chains", {
      method: "POST",
      headers: { "Idempotency-Key": "original-fixture-key" },
      body: JSON.stringify({ name: "PRIVATE_PAYLOAD_MUST_NOT_RENDER" }),
    }).catch(() => {});
    const Recovery = modules["./command-recovery.tsx"]?.LedgerRecoveryPanel;
    expect(Recovery, "Reload recovery presentation is missing").toBeTypeOf(
      "function",
    );
    if (!Recovery) return;
    render(
      <LedgerProviders>
        <Recovery />
      </LedgerProviders>,
    );
    await screen.findByTestId("ledger-recovery-panel");
    expect(
      screen.queryByText("PRIVATE_PAYLOAD_MUST_NOT_RENDER"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Đối soát|Reconcile/ }));
    await waitFor(() =>
      expect(
        screen.queryByTestId("ledger-recovery-panel"),
      ).not.toBeInTheDocument(),
    );
    expect(sends).toBe(1);
  } finally {
    restore();
  }
});
