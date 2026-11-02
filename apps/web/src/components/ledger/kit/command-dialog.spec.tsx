import { webcrypto } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type { components } from "@/lib/generated/api";
import { clearSession, setSession } from "@/lib/api-client";
import { ledgerRequest } from "@/lib/ledger/request";
import { actorA } from "@/test/ledger-actors";
import { installBrowserLocks } from "@/test/browser-locks";
import { setLocale } from "@/lib/ledger/i18n";
import { CommandForm } from "./command-dialog";
import { TextField } from "./form-fields";
import { LedgerProviders } from "../providers";
import { PERMISSION_SYNC_EVENT } from "@/lib/permission-sync";
vi.mock("next/navigation", () => ({
  usePathname: () => "/enterprise",
  useRouter: () => ({ replace: vi.fn() }),
}));
let permissionRevision = "a".repeat(64);
const productId = "33333333-3333-4333-8333-333333333333",
  endpoint = `/enterprise-workspace/products/${productId}`;
const product: components["schemas"]["ProductInput"] = {
  productName: "Xoài kiểm thử",
  sku: "XOAI-01",
  category: "FRUIT",
  defaultUnit: "kg",
  originFarmId: actorA.user.organizationId!,
  ingredients: "Xoài",
  storageConditions: "Nơi thoáng mát",
  usageInstructions: "Rửa sạch",
};
const schema = z.object({
  productName: z.string().min(3),
  reason: z.string().min(3),
});
type Wire = { path: string; method: string; body: string; key: string | null };
let restoreLocks: () => void;
beforeEach(() => {
  permissionRevision = "a".repeat(64);
  localStorage.clear();
  clearSession(false);
  setSession(actorA);
  restoreLocks = installBrowserLocks();
  vi.stubGlobal("crypto", webcrypto);
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
  act(() => setLocale("vi"));
});
afterEach(() => {
  cleanup();
  restoreLocks();
  clearSession(false);
  vi.unstubAllGlobals();
});
async function renderCommandScenario(
  outcome:
    | "committed-response-lost"
    | "not-found"
    | "rejected"
    | "known-conflict"
    | "conflict-rejected"
    | "conflict-not-found"
    | "conflict-inspection-failed"
    | "conflict-committed"
    | "validation-rejected",
) {
  const requests: Wire[] = [],
    done = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://api.test").pathname.replace(
        /^\/api/,
        "",
      );
      requests.push({
        path,
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
        key: new Headers(init?.headers).get("idempotency-key"),
      });
      if (path === "/auth/refresh")
        return Response.json({ success: true, data: actorA });
      if (path === "/chain-permissions")
        return Response.json({
          success: true,
          data: { accessRevision: permissionRevision, productionChains: [] },
        });
      if (path === endpoint) {
        if (outcome === "validation-rejected")
          return Response.json(
            {
              success: false,
              error: { code: "UNPROCESSABLE_ENTITY", message: "Chọn ít nhất một người nhận" },
            },
            { status: 422 },
          );
        if (outcome === "known-conflict" || outcome.startsWith("conflict-"))
          return Response.json(
            {
              success: false,
              error: { code: "VERSION_CONFLICT", message: "Version changed" },
            },
            { status: 409 },
          );
        if (requests.filter((r) => r.path === endpoint).length === 1)
          throw new TypeError("Committed response lost");
        return Response.json({
          success: true,
          data: { record: { id: productId, version: 2 } },
        });
      }
      if (path === "/command-requests/status") {
        if (outcome === "conflict-inspection-failed")
          throw new TypeError("Inspector unavailable");
        return Response.json({
          success: true,
          data:
            outcome === "not-found" || outcome === "validation-rejected" || outcome === "conflict-not-found"
              ? { status: "NOT_FOUND" }
              : outcome === "known-conflict"
                ? { status: "PROCESSING" }
              : outcome === "rejected" || outcome === "conflict-rejected"
                ? {
                    status: "REJECTED",
                    responseStatus: 409,
                    result: { message: "Version changed" },
                  }
                : {
                    status: "COMMITTED",
                    responseStatus: 200,
                    result: { record: { id: productId, version: 2 } },
                  },
        });
      }
      throw new Error(`Unexpected command path ${path}`);
    }),
  );
  const content = (
    <CommandForm
      title="Cập nhật sản phẩm"
      endpoint={endpoint}
      schema={schema}
      defaultValues={{
        productName: product.productName,
        reason: "Cập nhật thông tin",
      }}
      submitLabel="Lưu"
      onDone={done}
      run={(values, cmd) =>
        ledgerRequest(endpoint, {
          method: "POST",
          headers: { "Idempotency-Key": cmd.idempotencyKey },
          body: JSON.stringify({
            product: { ...product, productName: values.productName },
            reason: values.reason,
            status: "ACTIVE",
            version: 1,
          } satisfies components["schemas"]["ProductRevisionInput"]),
        })
      }
    >
      {(form) => (
        <TextField
          control={form.control}
          name="productName"
          label="Tên sản phẩm"
        />
      )}
    </CommandForm>
  );
  render(<LedgerProviders>{content}</LedgerProviders>);
  await screen.findByLabelText("Tên sản phẩm");
  return { requests, done };
}
it("freezes a lost response and inspects COMMITTED without sending another domain command", async () => {
  const { requests, done } = await renderCommandScenario(
    "committed-response-lost",
  );
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await screen.findByTestId("ledger-command-pending");
  expect(screen.getByLabelText("Tên sản phẩm")).toBeDisabled();
  expect(done).not.toHaveBeenCalled();
  const sent = requests.filter((r) => r.path === endpoint);
  expect(sent).toHaveLength(1);
  act(() => setLocale("en"));
  expect(screen.getByLabelText("Tên sản phẩm")).toHaveValue(
    product.productName,
  );
  fireEvent.click(screen.getByRole("button", { name: /Đối soát|Reconcile/ }));
  await waitFor(() =>
    expect(
      screen.queryByTestId("ledger-command-pending"),
    ).not.toBeInTheDocument(),
  );
  expect(requests.filter((r) => r.path === endpoint)).toEqual(sent);
  expect(done).toHaveBeenCalledTimes(1);
  expect(
    localStorage.getItem(
      `agritrace-command:v1:${JSON.stringify([actorA.user.id, actorA.user.organizationId])}`,
    ),
  ).not.toContain(product.productName);
});
it("serializes double click and retries NOT_FOUND with the exact original body and key", async () => {
  const { requests } = await renderCommandScenario("not-found");
  const save = screen.getByRole("button", { name: "Lưu" });
  fireEvent.click(save);
  fireEvent.click(save);
  await screen.findByTestId("ledger-command-pending");
  expect(requests.filter((r) => r.path === endpoint)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Đối soát" }));
  await waitFor(() =>
    expect(
      screen.queryByTestId("ledger-command-pending"),
    ).not.toBeInTheDocument(),
  );
  const sends = requests.filter((r) => r.path === endpoint);
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
});
it("keeps a journaled 409 frozen when automatic inspection returns PROCESSING", async () => {
  const { requests, done } = await renderCommandScenario("known-conflict");
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await screen.findByTestId("ledger-command-pending");
  expect(screen.getByLabelText("Tên sản phẩm")).toBeDisabled();
  expect(requests.filter((r) => r.path === "/command-requests/status")).toHaveLength(1);
  expect(requests.filter((r) => r.path === endpoint)).toHaveLength(1);
  expect(done).not.toHaveBeenCalled();
});
it("unlocks a 409 only after automatic journal inspection confirms REJECTED", async () => {
  const { requests, done } = await renderCommandScenario("conflict-rejected");
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await screen.findByText("Version changed");
  await waitFor(() => expect(screen.getByLabelText("Tên sản phẩm")).toBeEnabled());
  expect(screen.queryByTestId("ledger-command-pending")).not.toBeInTheDocument();
  const sent = requests.filter((r) => r.path === endpoint);
  const inspections = requests.filter((r) => r.path === "/command-requests/status");
  expect(sent).toHaveLength(1);
  expect(inspections).toHaveLength(1);
  expect(inspections[0].key).toBe(sent[0].key);
  expect(done).not.toHaveBeenCalled();
});
it.each(["conflict-not-found", "conflict-inspection-failed"] as const)(
  "does not resend or unlock a 409 when inspection is %s",
  async (outcome) => {
    const { requests, done } = await renderCommandScenario(outcome);
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await screen.findByTestId("ledger-command-pending");
    expect(screen.getByLabelText("Tên sản phẩm")).toBeDisabled();
    expect(requests.filter((r) => r.path === endpoint)).toHaveLength(1);
    expect(done).not.toHaveBeenCalled();
  },
);
it("uses the committed journal result after a 409 without resending or losing onDone", async () => {
  const { requests, done } = await renderCommandScenario("conflict-committed");
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(done).toHaveBeenCalledWith({ record: { id: productId, version: 2 } });
  expect(screen.queryByText("Version changed")).not.toBeInTheDocument();
  expect(requests.filter((r) => r.path === endpoint)).toHaveLength(1);
  expect(screen.queryByTestId("ledger-command-pending")).not.toBeInTheDocument();
});
it("unlocks a confirmed rejection without reporting success", async () => {
  const { done } = await renderCommandScenario("rejected");
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await screen.findByTestId("ledger-command-pending");
  fireEvent.click(screen.getByRole("button", { name: "Đối soát" }));
  await waitFor(() =>
    expect(
      screen.queryByTestId("ledger-command-pending"),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Tên sản phẩm")).toBeEnabled();
  expect(done).not.toHaveBeenCalled();
});
it("retains an actual uncertain command across permission revalidation without a new POST", async () => {
  const { requests, done } = await renderCommandScenario(
    "committed-response-lost",
  );
  await screen.findByLabelText("Tên sản phẩm");
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await screen.findByTestId("ledger-command-pending");
  const field = screen.getByLabelText("Tên sản phẩm");
  act(() => {
    permissionRevision = "d".repeat(64);
    window.dispatchEvent(new Event(PERMISSION_SYNC_EVENT));
  });
  await waitFor(() =>
    expect(screen.getByTestId("ledger-command-pending")).toBeVisible(),
  );
  expect(screen.getByLabelText("Tên sản phẩm")).toBe(field);
  expect(field).toBeDisabled();
  expect(field).toHaveValue(product.productName);
  fireEvent.click(screen.getByRole("button", { name: "Đối soát" }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(requests.filter((r) => r.path === endpoint)).toHaveLength(1);
});
it("reconciles a validation rejection at once so the form unlocks without a resend", async () => {
  const { requests, done } = await renderCommandScenario("validation-rejected");
  fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
  await screen.findByText("Chọn ít nhất một người nhận");
  await waitFor(() =>
    expect(screen.getByLabelText("Tên sản phẩm")).toBeEnabled(),
  );
  expect(screen.queryByTestId("ledger-command-pending")).not.toBeInTheDocument();
  expect(requests.filter((r) => r.path === endpoint)).toHaveLength(1);
  expect(done).not.toHaveBeenCalled();
});
