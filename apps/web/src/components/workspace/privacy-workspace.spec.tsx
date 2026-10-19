import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "@/lib/api-client";
import { commandRequest } from "@/lib/command-request";
import { PrivacyWorkspace } from "./privacy-workspace";

const auth = vi.hoisted(() => ({
  user: { id: "subject-a", organizationId: null, role: { code: "FARM_STAFF" } },
}));
vi.mock("@/lib/api-client", () => ({ request: vi.fn() }));
vi.mock("@/lib/auth-store", () => ({ useAuth: () => auth }));
const ticket = {
  id: "request-a",
  kind: "REQUEST",
  requestType: "ACCESS",
  status: "OPEN",
  reporting: "UNASSESSED",
  detectedAt: null,
  deadlineAt: null,
  reportedAt: null,
  overdue: false,
  version: 0,
  createdAt: "2026-10-18T00:00:00Z",
};
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  auth.user.id = "subject-a";
});

describe("Private request recovery and account isolation", () => {
  it("retries the identical private body and key after an unknown outcome without enabling saved-body recovery", async () => {
    let posts = 0;
    vi.mocked(request).mockImplementation(async (_path, init) => {
      if (init?.method === "POST") {
        posts++;
        if (posts === 1)
          throw { status: 503, message: "Kết quả chưa xác định" };
        return ticket;
      }
      return { items: [], nextCursor: null };
    });
    render(<PrivacyWorkspace />);
    fireEvent.click(screen.getByText("Gửi yêu cầu quyền dữ liệu"));
    fireEvent.change(screen.getByLabelText(/Nội dung riêng tư/), {
      target: { value: "Nội dung riêng tư cần được đối soát" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi hồ sơ" }));
    const retry = await screen.findByRole("button", {
      name: "Thử lại yêu cầu ban đầu",
    });
    expect(screen.getByLabelText(/Nội dung riêng tư/)).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(posts).toBe(2));
    const calls = vi
      .mocked(request)
      .mock.calls.filter(([, init]) => init?.method === "POST");
    expect(calls[1][1]?.body).toBe(calls[0][1]?.body);
    expect(calls[1][1]?.headers).toEqual(calls[0][1]?.headers);
    expect(
      commandRequest("/privacy-requests", "POST", String(calls[0][1]?.body)),
    ).toBeNull();
    expect(
      commandRequest(
        "/platform-privacy/breaches",
        "POST",
        String(calls[0][1]?.body),
      ),
    ).toBeNull();
  });

  it("discards a late private response after switching the signed-in subject", async () => {
    let complete: (value: unknown) => void = () => undefined;
    const late = new Promise((resolve) => {
      complete = resolve;
    });
    vi.mocked(request).mockImplementation(async (path) => {
      if (path === "/privacy-requests/request-a") return late;
      return {
        items: auth.user.id === "subject-a" ? [ticket] : [],
        nextCursor: null,
      };
    });
    const view = render(<PrivacyWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Xem" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/privacy-requests/request-a"),
    );
    auth.user.id = "subject-b";
    view.rerender(<PrivacyWorkspace />);
    await act(async () => {
      complete({ ...ticket, message: "PRIVATE SUBJECT A CONTENT", events: [] });
      await late;
    });
    expect(screen.queryByText("PRIVATE SUBJECT A CONTENT")).toBeNull();
    expect(screen.queryByText("Chi tiết hồ sơ")).toBeNull();
  });
});
