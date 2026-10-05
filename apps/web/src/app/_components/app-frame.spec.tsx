import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LotTrace } from "@/shared/types/domain";
import { useState } from "react";
import { getLots } from "@/features/lots/api";
import { AppFrame } from "@/app/_components/app-frame";

const { auth } = vi.hoisted(() => ({
  auth: {
    isAuthenticated: true,
    isLoading: false,
    user: {
      id: "first",
      fullName: "First user",
      role: { code: "SYSTEM_ADMIN", name: "Admin" },
    },
    logout: vi.fn(),
  },
}));
vi.mock("@/features/auth/auth-store", () => ({ useAuth: () => auth }));
vi.mock("@/features/lots/api", () => ({ getLots: vi.fn() }));
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
