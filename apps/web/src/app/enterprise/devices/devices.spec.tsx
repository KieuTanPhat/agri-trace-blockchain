import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import DevicesPage from "./page";

vi.mock("@/lib/api-client", () => ({ request: vi.fn() }));
vi.mock("@/lib/auth-store", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/pending-commands-panel", () => ({
  PendingCommandsPanel: () => null,
}));
const device = {
  id: "c51e4dbe-8279-4943-b68d-8433e3231192",
  name: "DHT22 test",
  deviceCode: "DEMO",
  version: 0,
  status: "ACTIVE",
  sourceType: "WOKWI_SIMULATED",
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "owner", organizationId: "org", role: { code: "TRANSPORTER" } },
    privateAccessStatus: "ready",
  } as ReturnType<typeof useAuth>);
  vi.mocked(request).mockImplementation(async (path) => {
    if (path === "/iot/devices/managed") return [device] as never;
    if (path.endsWith("/credentials")) return [] as never;
    return {} as never;
  });
});
afterEach(cleanup);

it("keeps credential secret in memory and retains exactly the original request after network loss", async () => {
  let failed = false;
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (path === "/iot/devices/managed") return [device] as never;
    if (!options) return [] as never;
    if (!failed) {
      failed = true;
      throw new TypeError("Mất phản hồi");
    }
    return {} as never;
  });
  render(<DevicesPage />);
  await screen.findByText("DHT22 test");
  fireEvent.click(screen.getByRole("button", { name: "Xem credential" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Cấp credential" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Token thiết bị")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Đối soát / thử lại yêu cầu gốc" }),
  );
  const field = await screen.findByLabelText("Token thiết bị");
  const token = (field as HTMLInputElement).value;
  const writes = vi
    .mocked(request)
    .mock.calls.filter(([, options]) => options?.method === "POST");
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[0][1]?.body).not.toContain(token.split(".")[1]);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Ẩn credential" }));
  expect(screen.queryByLabelText("Token thiết bị")).not.toBeInTheDocument();
});

it("drops private device rows when permission refresh is denied", async () => {
  render(<DevicesPage />);
  await screen.findByText("DHT22 test");
  vi.mocked(request).mockRejectedValueOnce({
    status: 403,
    message: "Quyền đã thu hồi",
  });
  fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
  await waitFor(() =>
    expect(screen.queryByText("DHT22 test")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Quyền đã thu hồi");
});
