import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LotTrace } from "@/lib/types";
import { useState } from "react";
import { getLots } from "@/lib/api-client";
import { AppFrame } from "./app-frame";

const { auth, location, replace } = vi.hoisted(() => ({
  location: { pathname: "/lots" },
  replace: vi.fn(),
  auth: {
    isAuthenticated: true,
    isLoading: false,
    privateAccessStatus: "ready" as "ready" | "checking" | "unavailable",
    user: {
      id: "first",
      fullName: "First user",
      organizationId: "first-org" as string | null,
      accessRevision: undefined as string | undefined,
      role: { code: "AUDITOR", name: "Kiểm toán" },
    },
    logout: vi.fn(),
  },
}));
vi.mock("@/lib/auth-store", () => ({ useAuth: () => auth }));
vi.mock("@/lib/api-client", () => ({
  getLots: vi.fn(),
  listPendingCommands: vi.fn().mockResolvedValue([]),
  retryPendingCommand: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useRouter: () => ({ replace }),
}));
vi.mock("next/image", () => ({ default: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  location.pathname = "/lots";
  auth.isAuthenticated = true;
  auth.isLoading = false;
  auth.privateAccessStatus = "ready";
  auth.user.accessRevision = undefined;
  auth.user.role = { code: "AUDITOR", name: "Kiểm toán" };
});
it("shows only platform functions for the system administrator and does not fetch private lot search data", async () => {
  auth.user.role = { code: "SYSTEM_ADMIN", name: "Quản trị hệ thống" };
  location.pathname = "/admin";
  render(
    <AppFrame>
      <p>Platform workspace</p>
    </AppFrame>,
  );
  await act(async () => {});
  expect(screen.getByText("Platform workspace")).toBeInTheDocument();
  expect(
    screen.getAllByRole("link", { name: /^Xét duyệt doanh nghiệp$/ }).length,
  ).toBeGreaterThan(0);
  expect(screen.queryByRole("link", { name: /^Vụ trồng$/ })).toBeNull();
  expect(
    screen.queryByRole("link", { name: /^Sản phẩm doanh nghiệp$/ }),
  ).toBeNull();
  expect(
    screen.getAllByRole("link", { name: /^Kiểm định viên$/ }).length,
  ).toBeGreaterThan(0);
  expect(screen.queryByRole("link", { name: /^Nông trại$/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /^Thửa đất$/ })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Tìm lô nông sản" })).toBeNull();
  expect(getLots).not.toHaveBeenCalled();
});

it.each(["/", "/scan", "/trace/token"])(
  "keeps %s public while authentication is loading",
  async (pathname) => {
    location.pathname = pathname;
    auth.isAuthenticated = false;
    auth.isLoading = true;
    render(
      <AppFrame>
        <p>Public information</p>
      </AppFrame>,
    );
    await act(async () => {});
    expect(screen.getByText("Public information")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(getLots).not.toHaveBeenCalled();
  },
);

it("requires login for the relocated dashboard", async () => {
  location.pathname = "/dashboard";
  auth.isAuthenticated = false;
  render(
    <AppFrame>
      <p>Private information</p>
    </AppFrame>,
  );
  await act(async () => {});
  expect(replace).toHaveBeenCalledWith("/login?next=%2Fdashboard");
  expect(screen.queryByText("Private information")).not.toBeInTheDocument();
});

it("hides private content during revalidation while preserving the same form until the revision changes", async () => {
  vi.mocked(getLots).mockResolvedValue([]);
  function Form() {
    const [text, setText] = useState("");
    return (
      <input
        aria-label="Pending form"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    );
  }
  auth.user.accessRevision = "a".repeat(64);
  const view = render(
    <AppFrame>
      <Form />
    </AppFrame>,
  );
  fireEvent.change(screen.getByLabelText("Pending form"), {
    target: { value: "original key body" },
  });
  auth.privateAccessStatus = "checking";
  view.rerender(
    <AppFrame>
      <Form />
    </AppFrame>,
  );
  expect(screen.getByLabelText("Pending form")).not.toBeVisible();
  auth.privateAccessStatus = "ready";
  view.rerender(
    <AppFrame>
      <Form />
    </AppFrame>,
  );
  expect(screen.getByLabelText("Pending form")).toHaveValue(
    "original key body",
  );
  auth.user.accessRevision = "b".repeat(64);
  view.rerender(
    <AppFrame>
      <Form />
    </AppFrame>,
  );
  expect(screen.getByLabelText("Pending form")).toHaveValue("");
  auth.privateAccessStatus = "unavailable";
  view.rerender(
    <AppFrame>
      <Form />
    </AppFrame>,
  );
  expect(screen.getByLabelText("Pending form")).not.toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Chưa kiểm tra được quyền hiện hành",
  );
  await act(async () => {});
});

describe("organization-scoped header search", () => {
  it("clears loaded data and remounts pages when the same user changes organization", async () => {
    auth.user = { ...auth.user, id: "same-user", organizationId: "old-org" };
    vi.mocked(getLots).mockResolvedValueOnce([
      {
        lotId: "old",
        lotCode: "OLD-ORG-LOT",
        productName: "Old product",
        farmOrg: { name: "Old farm" },
      } as LotTrace,
    ]);
    vi.mocked(getLots).mockResolvedValueOnce([]);
    function ScopedPage() {
      const [owner] = useState(auth.user.organizationId);
      return <p>{`content-${owner}`}</p>;
    }
    const view = render(
      <AppFrame>
        <ScopedPage />
      </AppFrame>,
    );
    await act(async () => {});
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "OLD" } });
    expect(await screen.findByText("OLD-ORG-LOT")).toBeInTheDocument();
    auth.user = { ...auth.user, organizationId: "new-org" };
    view.rerender(
      <AppFrame>
        <ScopedPage />
      </AppFrame>,
    );
    expect(screen.queryByText("content-old-org")).not.toBeInTheDocument();
    expect(screen.getByText("content-new-org")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "OLD" } });
    expect(screen.queryByText("OLD-ORG-LOT")).not.toBeInTheDocument();
    expect(getLots).toHaveBeenCalledTimes(2);
  });

  it("clears old results and discards an outstanding request when the user changes", async () => {
    let resolveOld!: (lots: LotTrace[]) => void;
    vi.mocked(getLots).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    vi.mocked(getLots).mockResolvedValueOnce([]);
    function ScopedPage() {
      const [owner] = useState(auth.user.id);
      return <p>{`content-${owner}`}</p>;
    }
    const view = render(
      <AppFrame>
        <ScopedPage />
      </AppFrame>,
    );
    auth.user = { ...auth.user, id: "second", fullName: "Second user" };
    view.rerender(
      <AppFrame>
        <ScopedPage />
      </AppFrame>,
    );
    expect(screen.queryByText("content-first")).not.toBeInTheDocument();
    expect(screen.getByText("content-second")).toBeInTheDocument();
    await act(async () => {
      resolveOld([
        {
          lotId: "old",
          lotCode: "OLD-LOT",
          productName: "Old product",
          farmOrg: { name: "Old farm" },
        } as LotTrace,
      ]);
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "OLD" } });
    expect(screen.queryByText("OLD-LOT")).not.toBeInTheDocument();
    expect(getLots).toHaveBeenCalledTimes(2);
  });
});
