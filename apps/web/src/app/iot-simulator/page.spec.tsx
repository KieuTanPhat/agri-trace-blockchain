import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getProductionCycles, sendSensorReading } from "@/lib/api-client";
import IotSimulatorPage from "./page";

const cycleId = "59c1b564-2736-4ea7-bdb5-701e20423f23";
vi.mock("@/lib/api-client", () => ({
  getProductionCycles: vi.fn(),
  sendSensorReading: vi.fn(),
}));
vi.mock("@/lib/iot-local-store", () => ({ saveStoredIotReading: vi.fn() }));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({
    user: { id: "u", role: { code: "FARM_STAFF" }, organizationId: "o" },
  }),
}));

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.mocked(getProductionCycles).mockResolvedValue([
    {
      id: cycleId,
      cycleCode: "CYCLE-1",
      currentState: "GROWING",
      canWriteProduction: true,
      product: { productName: "Rice" },
    },
  ] as never);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function ready() {
  render(<IotSimulatorPage />);
  await screen.findByRole("option", { name: /CYCLE-1/ });
  fireEvent.change(screen.getByLabelText(/Thiết bị/), {
    target: { value: "device-1" },
  });
}

it("reports a lost response as unknown and retries only the original body and key", async () => {
  vi.mocked(sendSensorReading)
    .mockRejectedValueOnce({ status: 0, code: "NETWORK_ERROR" })
    .mockResolvedValueOnce({ status: "accepted", readingId: "r" } as never);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: /Gửi dữ liệu/ }));
  expect(await screen.findByText(/Chưa rõ kết quả/)).toBeVisible();
  fireEvent.change(screen.getByLabelText(/Giá trị và đơn vị/), {
    target: { value: "99" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Gửi lại" }));
  await waitFor(() => expect(sendSensorReading).toHaveBeenCalledTimes(2));
  const [first, second] = vi.mocked(sendSensorReading).mock.calls;
  expect(second).toEqual(first);
  expect(first![0].value).toBe(27.5);
});

it("keeps a server rejection terminal", async () => {
  vi.mocked(sendSensorReading).mockRejectedValueOnce({
    status: 422,
    code: "VALIDATION_ERROR",
    message: "Chu kỳ không ở trạng thái nhận dữ liệu cảm biến",
  });
  await ready();
  fireEvent.click(screen.getByRole("button", { name: /Gửi dữ liệu/ }));
  expect(await screen.findByText(/Bị từ chối/)).toBeVisible();
  expect(screen.getAllByText(/không ở trạng thái nhận/).length).toBeGreaterThan(0);
});
