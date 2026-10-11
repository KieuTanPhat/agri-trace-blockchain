import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/types";
import SupplyChainsPage from "./page";

const api = vi.hoisted(() => ({ request: vi.fn(), getOrganizations: vi.fn() }));
let user: AuthUser;
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
