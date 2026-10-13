import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/types";
import SupplyChainsPage from "./page";

const api = vi.hoisted(() => ({ request: vi.fn(), getOrganizations: vi.fn() }));
let user: AuthUser;
afterEach(cleanup);
vi.mock("@/lib/api-client", () => api);
vi.mock("@/lib/auth-store", () => ({ useAuth: () => ({ user }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  user = {
    id: "owner-user",
    email: "owner@example.test",
    fullName: "Owner",
    accountStatus: "ACTIVE",
    organizationId: "owner-org",
    role: { code: "FARM_STAFF", name: "Sản xuất" },
  };
  api.getOrganizations.mockResolvedValue([
    { organizationId: "partner-org", name: "Đối tác cũ", type: "TRANSPORTER" },
  ]);
});

describe("Chain workspace scope isolation", () => {
  it("keeps one profile and one shipment workspace through repeated permission refreshes", async () => {
    api.request.mockImplementation((path: string) => {
      if (path === "/chain-permissions")
        return Promise.resolve({
          grants: [{ scope: "CHAIN", chainId: "one", role: "CHAIN_MANAGER" }],
          memberships: [
            { chainId: "one", organizationId: "owner-org", status: "ACTIVE" },
          ],
          capabilities: [],
          businessChains: ["one"],
        });
      if (path === "/supply-chains")
        return Promise.resolve([
          {
            id: "one",
            name: "Chuỗi đang hoạt động",
            ownerOrganizationId: "owner-org",
          },
        ]);
      if (path.endsWith("/ledger-status"))
        return Promise.resolve({
          chainId: path.split("/")[2],
          profile: "RELEASE_A",
          bindingStatus: null,
          channelId: null,
          permissions: { active: 0, pending: 0, revoking: 0, held: 0 },
          delivery: { completed: 0, pending: 0, retry: 0, deadLetter: 0, oldestPendingAt: null },
          openHolds: 0,
          pendingControlJobs: 0,
        });
      if (path.endsWith("/business-profile"))
        return Promise.resolve({
          state: "ACTIVE",
          version: 1,
          scopeVersion: 1,
          chainId: "one",
        });
      if (path.endsWith("/memberships") || path.includes("/shipment-plans"))
        return Promise.resolve([]);
      throw new Error(path);
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<SupplyChainsPage />);
      await screen.findByRole("option", { name: "Chuỗi đang hoạt động" });
      fireEvent.change(screen.getByLabelText("Chọn chuỗi"), {
        target: { value: "one" },
      });
      for (let refresh = 0; refresh < 3; refresh++) {
        await screen.findByText("Đang hoạt động");
        expect(
          screen.getAllByRole("region", { name: "Trạng thái nghiệp vụ chuỗi" }),
        ).toHaveLength(1);
        expect(
          screen.getAllByRole("region", { name: "Kế hoạch vận chuyển" }),
        ).toHaveLength(1);
        if (refresh < 2)
          fireEvent.click(
            screen.getByRole("button", { name: "Tải lại quyền và dữ liệu" }),
          );
      }
      expect(
        errors.mock.calls
          .flat()
          .some((item) => String(item).includes("same key")),
      ).toBe(false);
    } finally {
      errors.mockRestore();
    }
  });

  it("discards a slow membership response after selecting another chain", async () => {
    const slow = deferred<unknown[]>();
    api.request.mockImplementation((path: string) => {
      if (path === "/chain-permissions")
        return Promise.resolve({
          grants: [],
          memberships: [],
          capabilities: [],
        });
      if (path === "/supply-chains")
        return Promise.resolve([
          { id: "one", name: "Chuỗi một", ownerOrganizationId: "another-org" },
          { id: "two", name: "Chuỗi hai", ownerOrganizationId: "another-org" },
        ]);
      if (path === "/supply-chains/one/memberships") return slow.promise;
      if (path === "/supply-chains/two/memberships")
        return Promise.resolve([
          {
            id: "new",
            organizationId: "new-org",
            status: "ACTIVE",
            version: 0,
          },
        ]);
      if (path.endsWith("/ledger-status"))
        return Promise.resolve({
          chainId: path.split("/")[2],
          profile: "RELEASE_A",
          bindingStatus: null,
          channelId: null,
          permissions: { active: 0, pending: 0, revoking: 0, held: 0 },
          delivery: { completed: 0, pending: 0, retry: 0, deadLetter: 0, oldestPendingAt: null },
          openHolds: 0,
          pendingControlJobs: 0,
        });
      if (path.endsWith("/business-profile"))
        return Promise.resolve({
          chainId: path.split("/")[2],
          state: "ACTIVE",
          version: 1,
          scopeVersion: 1,
        });
      throw new Error(path);
    });
    render(<SupplyChainsPage />);
    await screen.findByRole("option", { name: "Chuỗi một" });
    const select = screen.getByLabelText("Chọn chuỗi");
    fireEvent.change(select, { target: { value: "one" } });
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        "/supply-chains/one/memberships",
      ),
    );
    fireEvent.change(select, { target: { value: "two" } });
    await screen.findByText(/new-org/);
    await act(async () =>
      slow.resolve([
        {
          id: "old",
          organizationId: "partner-org",
          status: "ACTIVE",
          version: 0,
        },
      ]),
    );
    expect(screen.queryByText(/Đối tác cũ/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Tạo chuỗi cung ứng" }),
    ).not.toBeInTheDocument();
  });

  it("clears loaded chains and ignores pending responses when the account changes", async () => {
    const slow = deferred<unknown[]>();
    api.request.mockImplementation((path: string) => {
      if (path === "/chain-permissions")
        return Promise.resolve({
          grants: [],
          memberships: [],
          capabilities: [],
        });
      if (path === "/supply-chains")
        return user.id === "owner-user" ? slow.promise : Promise.resolve([]);
      throw new Error(path);
    });
    const view = render(<SupplyChainsPage />);
    user = { ...user, id: "other-user", organizationId: "other-org" };
    view.rerender(<SupplyChainsPage />);
    await screen.findByText(/Bạn chưa có chuỗi/);
    await act(async () =>
      slow.resolve([
        {
          id: "old",
          name: "Chuỗi riêng tài khoản cũ",
          ownerOrganizationId: "owner-org",
        },
      ]),
    );
    expect(
      screen.queryByRole("option", { name: "Chuỗi riêng tài khoản cũ" }),
    ).not.toBeInTheDocument();
  });
});
