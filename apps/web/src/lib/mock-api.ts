import type { Dashboard, LotTrace, SensorReadingRequest, SensorReadingResponse } from "./types";

export const mockLots: LotTrace[] = [
  {
    lotId: "11111111-1111-4111-8111-111111111111",
    lotCode: "LOT-RAU-CCH-2026-001",
    productName: "Rau cải ngọt",
    harvestTime: "2026-09-15T02:00:00.000Z",
    initialQuantity: 120,
    availableQuantity: 120,
    unit: "kg",
    currentState: "HARVESTED",
    productionCycle: {
      cycleId: "21111111-1111-4111-8111-111111111111",
      cycleCode: "CYCLE-RAU-2026-01",
      currentState: "GROWING",
      startDate: "2026-08-18T02:00:00.000Z"
    },
    farmOrg: { organizationId: "org-farm-01", name: "HTX Rau Sạch Củ Chi", type: "FARM" },
    retailerOrg: { organizationId: "org-retail-01", name: "Cửa hàng GreenMart Quận 7", type: "RETAILER" },
    allowedCommands: ["createShipment", "reportDamage"],
    proofStatus: "VERIFIED",
    blockchainProof: {
      network: "Hyperledger Fabric test network",
      txId: "mock-fabric-tx-001",
      dataHash: "4efb2d9d4f7f6f2c9f7d3b3e5d6a9a104efb2d9d4f7f6f2c9f7d3b3e5d6a9a10",
      transactionStatus: "COMMITTED",
      recordedAt: "2026-09-15T02:00:02.000Z"
    },
    timeline: [
      {
        eventId: "evt-001",
        entityType: "PRODUCTION_CYCLE",
        eventType: "PRODUCTION_CYCLE_CREATED",
        eventTime: "2026-08-18T02:00:00.000Z",
        summary: "Khởi tạo vụ trồng với mã duy nhất trong trang trại.",
        proofStatus: "VERIFIED",
        actor: { userId: "user-farm-01", role: "FARM_STAFF", organizationId: "org-farm-01", organizationName: "HTX Rau Sạch Củ Chi" }
      },
      {
        eventId: "evt-002",
        entityType: "PRODUCTION_CYCLE",
        eventType: "PLANTING_RECORDED",
        eventTime: "2026-08-19T01:20:00.000Z",
        summary: "Ghi nhận gieo trồng; vụ chuyển sang PLANTED.",
        proofStatus: "VERIFIED",
        actor: { userId: "user-farm-01", role: "FARM_STAFF", organizationId: "org-farm-01", organizationName: "HTX Rau Sạch Củ Chi" }
      },
      {
        eventId: "evt-003",
        entityType: "HARVEST",
        eventType: "HARVEST_RECORDED",
        eventTime: "2026-09-15T02:00:00.000Z",
        summary: "Thu hoạch 120 kg và tạo lô thương phẩm độc lập.",
        proofStatus: "VERIFIED",
        actor: { userId: "user-farm-01", role: "FARM_STAFF", organizationId: "org-farm-01", organizationName: "HTX Rau Sạch Củ Chi" }
      }
    ]
  },
  {
    lotId: "12222222-2222-4222-8222-222222222222",
    lotCode: "LOT-XOA-NBE-2026-002",
    productName: "Xoài cát",
    harvestTime: "2026-09-16T01:00:00.000Z",
    initialQuantity: 350,
    availableQuantity: 345,
    unit: "kg",
    currentState: "IN_TRANSPORT",
    productionCycle: {
      cycleId: "22222222-2222-4222-8222-222222222222",
      cycleCode: "CYCLE-XOA-2026-02",
      currentState: "COMPLETED"
    },
    farmOrg: { organizationId: "org-farm-02", name: "Trang trại Nhà Bè", type: "FARM" },
    retailerOrg: { organizationId: "org-retail-02", name: "Fresh Hub Thủ Đức", type: "RETAILER" },
    allowedCommands: ["reportArrival", "reportDamage"],
    proofStatus: "VERIFIED",
    blockchainProof: {
      network: "Hyperledger Fabric test network",
      txId: "mock-fabric-tx-002",
      dataHash: "a923f75ce614c1f33d893abb2b412ac0a923f75ce614c1f33d893abb2b412ac0",
      transactionStatus: "COMMITTED",
      recordedAt: "2026-09-17T03:10:00.000Z"
    },
    timeline: [
      {
        eventId: "evt-011",
        entityType: "HARVEST",
        eventType: "HARVEST_RECORDED",
        eventTime: "2026-09-16T01:00:00.000Z",
        summary: "Thu hoạch và tạo Lot HARVESTED.",
        proofStatus: "VERIFIED",
        actor: { userId: "user-farm-02", role: "FARM_STAFF", organizationId: "org-farm-02", organizationName: "Trang trại Nhà Bè" }
      },
      {
        eventId: "evt-012",
        entityType: "SHIPMENT",
        eventType: "TRANSPORT_STARTED",
        eventTime: "2026-09-17T03:10:00.000Z",
        summary: "Đơn vị vận chuyển nhận custody và bắt đầu Shipment.",
        proofStatus: "VERIFIED",
        actor: { userId: "user-transport-01", role: "TRANSPORTER", organizationId: "org-transport-01", organizationName: "Vận tải Sài Gòn" }
      }
    ]
  }
];

export function mockDashboard(): Dashboard {
  return {
    featuredLot: mockLots[0],
    stats: [
      { label: "Lô đang theo dõi", value: "12" },
      { label: "Bằng chứng đang chờ", value: "3" },
      { label: "Chuyến vận chuyển mở", value: "4" }
    ]
  };
}

export async function mockSubmitCommand(lotId: string, command: string) {
  await delay(250);
  return { ok: true, lotId, command, message: `Đã tiếp nhận thao tác ${command}; máy chủ sẽ kiểm tra actor, custody, state, version và idempotency key.` };
}

export async function mockSendSensorReading(request: SensorReadingRequest): Promise<SensorReadingResponse> {
  await delay(250);
  if (!Number.isFinite(request.value)) {
    return { status: "rejected", error: { status: 422, code: "VALIDATION_ERROR", message: "Giá trị cảm biến phải là số hợp lệ." } };
  }
  return {
    status: "accepted",
    readingId: `reading-${Date.now()}`,
    digestPreview: { periodStart: request.timestamp, periodEnd: request.timestamp, readingCount: 1 }
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
