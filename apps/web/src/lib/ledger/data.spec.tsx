import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { actorA } from "@/test/ledger-actors";
import { getAuthorizationScope } from "@/lib/auth-scope";
const access = vi.hoisted(() => ({
  revision: "a".repeat(64),
  status: "checking",
}));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({
    user: { ...actorA.user, accessRevision: access.revision },
    privateAccessStatus: access.status,
  }),
}));
type DataModule = {
  useLedgerQuery: (options: UseQueryOptions<string>) => {
    data: string | undefined;
  };
  useLedgerQueryClient: () => {
    invalidateQueries: (filter: {
      queryKey: readonly unknown[];
    }) => Promise<void>;
  };
};
const modules = import.meta.glob<DataModule>("./data.ts", { eager: true });
beforeEach(() => {
  access.revision = "a".repeat(64);
  access.status = "checking";
});
afterEach(cleanup);
it("does not request private data before current authority, then scopes and invalidates actual Ledger queries", async () => {
  const data = modules["./data.ts"];
  expect(data, "Scoped Ledger data adapter is missing").toBeDefined();
  if (!data) return;
  const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
    request = vi.fn(async () => "PRIVATE_RECORD");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender } = renderHook(
    () => ({
      query: data.useLedgerQuery({
        queryKey: ["enrollments"],
        queryFn: request,
      }),
      cache: data.useLedgerQueryClient(),
    }),
    { wrapper },
  );
  expect(request).not.toHaveBeenCalled();
  access.status = "ready";
  rerender();
  await waitFor(() => expect(result.current.query.data).toBe("PRIVATE_RECORD"));
  expect(
    client.getQueryData([
      "ledger",
      getAuthorizationScope({
        ...actorA.user,
        accessRevision: access.revision,
      }),
      "enrollments",
    ]),
  ).toBe("PRIVATE_RECORD");
  await act(() =>
    result.current.cache.invalidateQueries({ queryKey: ["enrollments"] }),
  );
  expect(request).toHaveBeenCalledTimes(2);
  access.revision = "b".repeat(64);
  rerender();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
});
