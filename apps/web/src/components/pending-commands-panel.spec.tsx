import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingCommandsPanel } from "./pending-commands-panel";

const fixture = vi.hoisted(() => ({
  auth: {
    user: {
      id: "one",
      organizationId: "org-one",
      role: { code: "FARM_STAFF" },
    },
    privateAccessStatus: "ready",
  },
  list: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@/lib/auth-store", () => ({ useAuth: () => fixture.auth }));
vi.mock("@/lib/api-client", () => ({
  listPendingCommands: fixture.list,
  retryPendingCommand: fixture.retry,
}));
beforeEach(() => {
  fixture.auth.user = {
    id: "one",
    organizationId: "org-one",
    role: { code: "FARM_STAFF" },
  };
  fixture.auth.privateAccessStatus = "ready";
  fixture.list
    .mockReset()
    .mockResolvedValue([
      {
        id: "saved-original-reference",
        operation: "HYB_ACTIVATE_BUSINESS_PROFILE",
      },
    ]);
  fixture.retry
    .mockReset()
    .mockResolvedValue({ state: "ACTIVE", privateResult: "discarded" });
});
afterEach(() => cleanup());

describe("Pending request recovery after a form disappears", () => {
  it("loads metadata on mount and only recovers the original reference after an explicit click", async () => {
    const settled = vi.fn();
    render(<PendingCommandsPanel onSettled={settled} />);
    await screen.findByText("Kích hoạt nghiệp vụ chuỗi");
    expect(fixture.retry).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Kiểm tra và thử lại" }),
    );
    await act(async () => {});
    expect(fixture.retry).toHaveBeenCalledWith("saved-original-reference");
    expect(settled).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("discarded")).not.toBeInTheDocument();
  });
  it("keeps uncertain requests available and never signals a settled outcome", async () => {
    fixture.retry.mockRejectedValueOnce({
      status: 409,
      message: "Yêu cầu vẫn cần đối soát.",
    });
    const settled = vi.fn();
    render(<PendingCommandsPanel onSettled={settled} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Kiểm tra và thử lại" }),
    );
    await screen.findByRole("alert");
    expect(settled).not.toHaveBeenCalled();
    expect(screen.getByText("Kích hoạt nghiệp vụ chuỗi")).toBeInTheDocument();
  });
  it("ignores a slow metadata response from a previous account and hides the queue during access checks", async () => {
    let resolve!: (items: object[]) => void;
    fixture.list
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValue([]);
    const view = render(<PendingCommandsPanel onSettled={vi.fn()} />);
    fixture.auth.user = {
      id: "two",
      organizationId: "org-two",
      role: { code: "FARM_STAFF" },
    };
    view.rerender(<PendingCommandsPanel onSettled={vi.fn()} />);
    await act(async () =>
      resolve([
        { id: "old-owner", operation: "HYB_ACTIVATE_BUSINESS_PROFILE" },
      ]),
    );
    expect(
      screen.queryByRole("button", { name: "Kiểm tra và thử lại" }),
    ).not.toBeInTheDocument();
    fixture.auth.privateAccessStatus = "checking";
    view.rerender(<PendingCommandsPanel onSettled={vi.fn()} />);
    expect(
      screen.queryByRole("region", { name: "Yêu cầu cần đối soát" }),
    ).not.toBeInTheDocument();
  });
});
