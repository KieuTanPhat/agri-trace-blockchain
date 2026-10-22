import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAuth } from "@/lib/auth-store";
import { clearSession, readSession, setSession } from "@/lib/api-client";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { actorA, actorB } from "@/test/ledger-actors";
import { LedgerProviders as Providers } from "./providers";
import { setLocale } from "@/lib/ledger/i18n";
import { PERMISSION_SYNC_EVENT } from "@/lib/permission-sync";
const access = vi.hoisted(() => ({ revision: "a".repeat(64) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/enterprise",
  useRouter: () => ({ replace: vi.fn() }),
}));
const clients = new Map<string, QueryClient>();
function PrivateProbe() {
  const { user, privateAccessStatus } = useAuth();
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const scope = getAuthorizationScope(user);
  clients.set(user?.id ?? "anonymous", client);
  const result = useQuery({
    queryKey: ["ledger", scope, "private-record"],
    enabled: !!user && privateAccessStatus === "ready",
    queryFn: () =>
      user?.id === actorA.user.id
        ? Promise.resolve("PRIVATE_A_RECORD")
        : new Promise<string>(() => {}),
  });
  return (
    <>
      <label>
        Draft
        <input value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <div>{privateAccessStatus === "ready" && result.data}</div>
    </>
  );
}
beforeEach(() => {
  access.revision = "a".repeat(64);
  clearSession(false);
  localStorage.clear();
  clients.clear();
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
          data: {
            accessRevision:
              readSession()?.user.id === actorA.user.id
                ? access.revision
                : "b".repeat(64),
            productionChains: [],
          },
        });
      throw new Error(`Unexpected request ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  clearSession(false);
  vi.unstubAllGlobals();
});
it("removes actor A's rendered record and cache before actor B's request resolves", async () => {
  render(
    <Providers>
      <PrivateProbe />
    </Providers>,
  );
  await screen.findByText("PRIVATE_A_RECORD");
  const prior = clients.get(actorA.user.id)!;
  expect(
    prior
      .getQueryCache()
      .getAll()
      .some((q) => q.state.data === "PRIVATE_A_RECORD"),
  ).toBe(true);
  act(() => setSession(actorB));
  await waitFor(() =>
    expect(screen.queryByText("PRIVATE_A_RECORD")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(prior.getQueryCache().getAll()).toHaveLength(0));
  expect(clients.get(actorB.user.id)).not.toBe(prior);
});
it("locale change preserves the mounted draft and authenticated identity", async () => {
  render(
    <Providers>
      <PrivateProbe />
    </Providers>,
  );
  await screen.findByText("PRIVATE_A_RECORD");
  const field = screen.getByLabelText("Draft");
  fireEvent.change(field, { target: { value: "original pending command" } });
  const client = clients.get(actorA.user.id);
  act(() => setLocale("en"));
  expect(screen.getByLabelText("Draft")).toBe(field);
  expect(field).toHaveValue("original pending command");
  expect(readSession()?.user.id).toBe(actorA.user.id);
  expect(clients.get(actorA.user.id)).toBe(client);
});
it("logout_clears_scope after a private record has actually been rendered and cached", async () => {
  render(
    <Providers>
      <PrivateProbe />
    </Providers>,
  );
  await screen.findByText("PRIVATE_A_RECORD");
  const previous = clients.get(actorA.user.id)!;
  act(() => clearSession());
  await waitFor(() =>
    expect(screen.queryByText("PRIVATE_A_RECORD")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(previous.getQueryCache().getAll()).toHaveLength(0),
  );
  expect(readSession()).toBeNull();
});
it("permission revision purges the old scope while preserving the same-actor pending form through revalidation", async () => {
  render(
    <Providers>
      <PrivateProbe />
    </Providers>,
  );
  await screen.findByText("PRIVATE_A_RECORD");
  fireEvent.change(screen.getByLabelText("Draft"), {
    target: { value: "original submitted body and key" },
  });
  const previous = clients.get(actorA.user.id)!;
  act(() => {
    access.revision = "c".repeat(64);
    window.dispatchEvent(new Event(PERMISSION_SYNC_EVENT));
  });
  await waitFor(() =>
    expect(
      previous
        .getQueryCache()
        .getAll()
        .some(
          (query) =>
            query.queryKey[1] ===
            getAuthorizationScope({
              ...actorA.user,
              accessRevision: access.revision,
            }),
        ),
    ).toBe(true),
  );
  expect(screen.getByLabelText("Draft")).toHaveValue(
    "original submitted body and key",
  );
  await waitFor(() =>
    expect(
      previous
        .getQueryCache()
        .getAll()
        .every(
          (query) =>
            query.queryKey[1] ===
            getAuthorizationScope({
              ...actorA.user,
              accessRevision: access.revision,
            }),
        ),
    ).toBe(true),
  );
});
