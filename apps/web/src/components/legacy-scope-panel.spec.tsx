import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LegacyScopePanel } from "./legacy-scope-panel";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => api);
const proposal = (stage: string, key = stage) => ({
  key,
  chainId: "chain",
  chainName: "Chuỗi rau",
  subjectLabel: "Lô rau số 1",
  stage,
  subjectId: "subject",
  manifestDigest: "a".repeat(64),
  planDigest: "b".repeat(64),
  confirmationStatus: "PENDING",
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Legacy participant confirmation", () => {
  it("shows a recorded confirmation without offering another submission", async () => {
    api.request.mockResolvedValue([
      { ...proposal("PRODUCTION"), confirmationStatus: "CONFIRMED" },
    ]);
    render(<LegacyScopePanel manifestId="one" />);
    await screen.findByText("Đã ghi nhận xác nhận công đoạn.");
    expect(
      screen.queryByRole("button", { name: "Xác nhận vai trò sản xuất" }),
    ).not.toBeInTheDocument();
  });
  it("requires a new owner review when a previous confirmation loses authority", async () => {
    api.request.mockResolvedValue([
      { ...proposal("TRANSPORT"), confirmationStatus: "REVIEW_REQUIRED" },
    ]);
    render(<LegacyScopePanel manifestId="one" />);
    await screen.findByText(
      "Xác nhận trước không còn hiệu lực. Cần chủ chuỗi chuẩn bị bản xác nhận mới.",
    );
    expect(
      screen.queryByRole("button", { name: "Xác nhận vai trò vận chuyển" }),
    ).not.toBeInTheDocument();
  });
  it("requires a distinct confirmation for each stage in the same enterprise", async () => {
    api.request.mockImplementation((_path: string, options?: RequestInit) =>
      Promise.resolve(
        options?.method === "POST"
          ? {}
          : [proposal("PRODUCTION"), proposal("TRANSPORT"), proposal("RETAIL")],
      ),
    );
    render(<LegacyScopePanel manifestId="one" />);
    const production = await screen.findByRole("button", {
      name: "Xác nhận vai trò sản xuất",
    });
    fireEvent.click(production);
    await screen.findByText("Đã ghi nhận xác nhận công đoạn.");
    expect(
      screen.getByRole("button", { name: "Xác nhận vai trò vận chuyển" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Xác nhận vai trò bán lẻ" }),
    ).toBeInTheDocument();
    expect(api.request).toHaveBeenCalledWith(
      "/legacy-scope/manifests/one/confirm",
      expect.objectContaining({
        body: JSON.stringify({ proposalKey: "PRODUCTION" }),
      }),
    );
  });
  it("keeps the idempotency key when retrying a confirmation whose outcome is unknown", async () => {
    let attempts = 0;
    api.request.mockImplementation((_path: string, options?: RequestInit) =>
      options?.method === "POST"
        ? ++attempts === 1
          ? Promise.reject(new Error("Chưa rõ kết quả"))
          : Promise.resolve({})
        : Promise.resolve([proposal("TRANSPORT")]),
    );
    render(<LegacyScopePanel manifestId="one" />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Xác nhận vai trò vận chuyển",
      }),
    );
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Tải lại phạm vi xác nhận" }),
    );
    await screen.findByRole("button", { name: "Xác nhận vai trò vận chuyển" });
    fireEvent.click(
      screen.getByRole("button", { name: "Xác nhận vai trò vận chuyển" }),
    );
    await screen.findByText("Đã ghi nhận xác nhận công đoạn.");
    const calls = api.request.mock.calls.filter(
      (call) => call[1]?.method === "POST",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0][1].headers).toEqual(calls[1][1].headers);
  });
  it("discards the prior manifest response after navigation", async () => {
    let resolve!: (value: unknown) => void;
    api.request.mockImplementation((path: string) =>
      path.includes("one")
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve([proposal("RETAIL")]),
    );
    const view = render(<LegacyScopePanel manifestId="one" />);
    view.rerender(<LegacyScopePanel manifestId="two" />);
    await screen.findByRole("button", { name: "Xác nhận vai trò bán lẻ" });
    await act(async () => resolve([proposal("PRODUCTION")]));
    expect(
      screen.queryByRole("button", { name: "Xác nhận vai trò sản xuất" }),
    ).not.toBeInTheDocument();
  });
  it("removes old proposals when current authority cannot be refreshed", async () => {
    api.request.mockResolvedValue([proposal("TRANSPORT")]);
    render(<LegacyScopePanel manifestId="one" />);
    await screen.findByRole("button", { name: "Xác nhận vai trò vận chuyển" });
    api.request.mockRejectedValue(new Error("Quyền đã thay đổi"));
    fireEvent.click(
      screen.getByRole("button", { name: "Tải lại phạm vi xác nhận" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Xác nhận vai trò vận chuyển" }),
      ).not.toBeInTheDocument(),
    );
    await screen.findByRole("alert");
  });
});
