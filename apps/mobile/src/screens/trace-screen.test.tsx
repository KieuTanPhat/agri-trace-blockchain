import { render, screen } from "@testing-library/react-native";

import type { PublicLot } from "@/api/public-trace";
import { ThemeProvider } from "@/theme/ThemeProvider";

import TraceScreen from "../../app/trace/[token]";

jest.mock("expo-router", () => ({ router: { back: jest.fn() }, useLocalSearchParams: () => ({ token: "st25-token" }) }));

const mockGetPublicTrace = jest.fn();
jest.mock("@/api/public-trace", () => ({ getPublicTrace: (...args: unknown[]) => mockGetPublicTrace(...args) }));

const lot = {
  lotId: "6b0a3c8e-0000-4000-8000-000000000201",
  lotCode: "LOT-ST-2610-0201",
  traceToken: "st25-token",
  productName: "Gạo ST25",
  farmOrg: { organizationId: "6b0a3c8e-0000-4000-8000-000000000001", name: "HTX Lúa gạo Mỹ Xuyên", type: "FARM" },
  currentState: "RECALLED",
  proofStatus: "VERIFIED",
  harvestTime: "2026-10-09T00:20:00.000Z",
  initialQuantity: 5000,
  availableQuantity: 5000,
  unit: "kg",
  expiryDate: null,
  isExpired: false,
  warnings: ["RECALLED"],
  sensorEvidence: { status: "FINALIZED", lateReadingCount: 0, readingCount: 12, digestHash: null, finalizedAt: null, periodStart: null, periodEnd: null },
  shipment: null,
  timeline: [
    {
      eventId: "6b0a3c8e-0000-4000-8000-000000000301",
      eventTime: "2026-10-09T00:20:00.000Z",
      eventType: "HARVEST_RECORDED",
      entityType: "HARVEST",
      summary: "Thu hoạch 5.000 kg lúa tươi",
      proofStatus: "VERIFIED",
      actor: { organizationName: "HTX Lúa gạo Mỹ Xuyên", role: "SYSTEM_ACTOR" },
    },
  ],
  certificates: [],
  allowedCommands: [],
  quantityReconciled: true,
  stateReconciled: true,
  productionCycle: { cycleId: "6b0a3c8e-0000-4000-8000-000000000101", cycleCode: "HT-2026-04", currentState: "COMPLETED", startDate: null },
} as unknown as PublicLot;

describe("trace screen", () => {
  it("shows a recall next to a verified proof without merging the two", async () => {
    mockGetPublicTrace.mockResolvedValue(lot);
    await render(
      <ThemeProvider initialMode="light">
        <TraceScreen />
      </ThemeProvider>,
    );
    expect(await screen.findByText("Gạo ST25")).toBeTruthy();
    expect(screen.getByText("Lô hàng đã được thu hồi. Liên hệ điểm bán để xử lý.")).toBeTruthy();
    expect(screen.getAllByText("Đã khớp bằng chứng").length).toBeGreaterThan(0);
    expect(screen.getByText("Xác minh dữ liệu không bị sửa — không thay thế chứng nhận chất lượng.")).toBeTruthy();
    expect(screen.getByText("5.000 kg")).toBeTruthy();
    expect(screen.getByText("Thu hoạch 5.000 kg lúa tươi")).toBeTruthy();
    expect(mockGetPublicTrace).toHaveBeenCalledWith("st25-token", expect.anything());
  });

  it("offers another code when the lot does not exist", async () => {
    mockGetPublicTrace.mockResolvedValue(null);
    await render(
      <ThemeProvider initialMode="light">
        <TraceScreen />
      </ThemeProvider>,
    );
    expect(await screen.findByText("Không tìm thấy lô hàng")).toBeTruthy();
    expect(screen.getByText("Nhập mã khác")).toBeTruthy();
  });
});
