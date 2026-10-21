import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getProductionCycles, request } from "@/lib/api-client";
import CyclesPage from "./page";

vi.mock("@/lib/api-client", () => ({
  getProductionCycles: vi.fn(),
  request: vi.fn(),
  retryPendingCommand: vi.fn(),
}));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({
    user: { id: "u", role: { code: "FARM_STAFF" }, organizationId: "o" },
  }),
}));

let state = "PLANTED";
let writable = true;
let rejection = "";
const closeTitle = "Kết thúc vụ trồng (ngừng chăm sóc và thu hoạch)";
const cancelTitle = "Hủy vụ trồng (không thể mở lại)";
const cycle = () => ({
  id: "cycle-1",
  cycleCode: "CYCLE-1",
  currentState: state,
  version: 7,
  canWriteProduction: writable,
  product: { productName: "Lúa", defaultUnit: "kg" },
  farm: { name: "Nông trại" },
  plot: null,
  careRecords: [],
  harvestEvents: [],
  harvestUnit: "kg",
});

beforeEach(() => {
  state = "PLANTED";
  writable = true;
  rejection = "";
  vi.mocked(getProductionCycles).mockImplementation(
    async () => [cycle()] as never,
  );
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (options?.method === "POST") {
      if (rejection) throw new Error(rejection);
      state = path.endsWith("/close") ? "COMPLETED" : "CANCELLED";
      return cycle() as never;
    }
    if (path === "/chain-permissions") return { productionChains: [] } as never;
    if (path === "/production-cycles/cycle-1") return cycle() as never;
    throw new Error(`Unexpected request ${path}`);
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function openCycle() {
  render(<CyclesPage />);
  fireEvent.click(
    (await screen.findAllByRole("button", { name: "Xem vụ CYCLE-1" }))[0]!,
  );
  await screen.findByRole("heading", { name: "Lịch sử chăm sóc" });
}

it.each([
  ["CREATED", true, false, true],
  ["PLANTED", false, true, true],
  ["GROWING", false, true, true],
  ["COMPLETED", false, false, false],
  ["CANCELLED", false, false, false],
] as const)(
  "shows valid commands in %s",
  async (current, plant, active, cancel) => {
    state = current;
    await openCycle();
    for (const [name, shown] of [
      ["Ghi nhận gieo trồng", plant],
      ["Ghi nhận chăm sóc", active],
      ["Ghi nhận thu hoạch", active],
      [closeTitle, active],
      [cancelTitle, cancel],
    ] as const)
      expect(Boolean(screen.queryByRole("button", { name }))).toBe(shown);
  },
);

it("honors the server denial even for a FARM_STAFF account", async () => {
  writable = false;
  await openCycle();
  expect(
    screen.queryByRole("button", { name: closeTitle }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: cancelTitle }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Ghi nhận chăm sóc" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Ghi nhận thu hoạch" }),
  ).not.toBeInTheDocument();
});

it.each(["close", "cancel"])(
  "sends current version for %s and removes commands after success",
  async (command) => {
    await openCycle();
    if (command === "cancel")
      fireEvent.change(screen.getByLabelText("Lý do hủy *"), {
        target: { value: "Dừng vụ" },
      });
    fireEvent.click(
      screen.getByRole("button", {
        name: command === "close" ? closeTitle : cancelTitle,
      }),
    );
    await screen.findByText("Đã ghi nhận thành công.");
    const call = vi
      .mocked(request)
      .mock.calls.find(([, options]) => options?.method === "POST");
    expect(call?.[0]).toBe(`/production-cycles/cycle-1/${command}`);
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({
      version: 7,
      ...(command === "cancel" ? { reason: "Dừng vụ" } : {}),
    });
    expect(call?.[1]?.headers).toHaveProperty("idempotency-key");
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: cancelTitle }),
      ).not.toBeInTheDocument(),
    );
  },
);

it.each([
  "Version hoặc trạng thái chu kỳ không hợp lệ",
  "Chưa có quyền nghiệp vụ trong chuỗi",
])("shows API rejection: %s", async (message) => {
  rejection = message;
  await openCycle();
  fireEvent.click(screen.getByRole("button", { name: closeTitle }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.queryByText("Đã ghi nhận thành công.")).not.toBeInTheDocument();
});
