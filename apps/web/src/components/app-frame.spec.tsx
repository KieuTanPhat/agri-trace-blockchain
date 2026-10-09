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

const { auth } = vi.hoisted(() => ({
  auth: {
    isAuthenticated: true,
    isLoading: false,
    user: {
      id: "first",
      fullName: "First user",
      organizationId: "first-org" as string | null,
      role: { code: "SYSTEM_ADMIN", name: "Admin" },
    },
    logout: vi.fn(),
  },
}));
vi.mock("@/lib/auth-store", () => ({ useAuth: () => auth }));
vi.mock("@/lib/api-client", () => ({ getLots: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/lots",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("next/image", () => ({ default: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
