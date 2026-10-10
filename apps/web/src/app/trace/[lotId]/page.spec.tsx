import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PublicTracePage from "./page";
import { getPublicTrace } from "@/lib/api-client";
import { mockLots, mockPublicTrace } from "@/lib/mock-api";
import type { ProofStatus } from "@/lib/types";

vi.mock("@/lib/api-client", () => ({ getPublicTrace: vi.fn() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/qr-code-card", () => ({ QrCodeCard: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([
  ["VERIFIED", "verified", "success"],
  ["PENDING", "pending", "warning"],
  ["INTEGRITY_WARNING", "mismatch", "danger"],
  ["BLOCKCHAIN_UNAVAILABLE", "unavailable", "warning"],
] as [ProofStatus, string, string][])(
  "uses the correct proof and badge color for %s",
  async (proofStatus, proofTone, badgeTone) => {
    const trace = mockPublicTrace(mockLots[0].lotId)!;
    vi.mocked(getPublicTrace).mockResolvedValue({ ...trace, proofStatus });
    const page = await PublicTracePage({
      params: Promise.resolve({ lotId: mockLots[0].lotId }),
    });
    const { container } = render(page);
    expect(container.querySelector(".proof-summary")).toHaveClass(
      `proof-${proofTone}`,
    );
    expect(container.querySelectorAll(`.badge.${badgeTone}`).length).toBeGreaterThan(0);
  },
);
