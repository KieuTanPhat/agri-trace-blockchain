import type { Batch, Dashboard, SensorReadingRequest, SensorReadingResponse } from "./types";

export const mockBatches: Batch[] = [
  {
    batchId: "batch-rau-001",
    batchCode: "RAU-CCH-2026-001",
    productName: "Rau cải ngọt",
    currentState: "PLANTED",
    farmOrg: { organizationId: "org-farm-01", name: "HTX Rau Sạch Củ Chi", type: "FARM" },
    retailerOrg: { organizationId: "org-retail-01", name: "Cửa hàng GreenMart Quận 7", type: "RETAILER" },
    allowedCommands: ["recordCare", "recordHarvest"],
    proofStatus: "verified",
    blockchainProof: {
      network: "Hyperledger Fabric test network",
      txId: "0xmock-fabric-tx-001",
      dataHash: "sha256:4efb2d9d4f7f6f2c9f7d3b3e5d6a9a10",
      recordedAt: "2026-08-20T04:30:00.000Z"
    },
    timeline: [
      {
        eventId: "evt-001",
        eventType: "BATCH_CREATED",
        eventTime: "2026-08-18T02:00:00.000Z",
        summary: "Khởi tạo lô với batchCode duy nhất.",
        proofStatus: "verified",
        actor: {
          userId: "user-farm-01",
          role: "FARM_STAFF",
          organizationId: "org-farm-01",
          organizationName: "HTX Rau Sạch Củ Chi"
        }
      },
      {
        eventId: "evt-002",
        eventType: "PLANTING_RECORDED",
        eventTime: "2026-08-19T01:20:00.000Z",
        summary: "Ghi nhận gieo trồng, chuyển CREATED sang PLANTED.",
        proofStatus: "verified",
        actor: {
          userId: "user-farm-01",
          role: "FARM_STAFF",
          organizationId: "org-farm-01",
          organizationName: "HTX Rau Sạch Củ Chi"
        }
      },
      {
        eventId: "evt-003",
        eventType: "SENSOR_RECORDED",
        eventTime: "2026-08-20T04:30:00.000Z",
        summary: "Ghi digest cảm biến nhiệt độ/độ ẩm trong giai đoạn chăm sóc.",
        proofStatus: "pending",
        actor: {
          userId: "device-cu-chi-01",
          role: "IOT_DEVICE",
          organizationId: "org-farm-01",
          organizationName: "HTX Rau Sạch Củ Chi"
        }
      }
    ]
  },
  {
    batchId: "batch-xoai-002",
    batchCode: "XOA-NBE-2026-002",
    productName: "Xoài cát",
    currentState: "IN_TRANSPORT",
    farmOrg: { organizationId: "org-farm-02", name: "Trang trại Nhà Bè", type: "FARM" },
    retailerOrg: { organizationId: "org-retail-02", name: "Fresh Hub Thủ Đức", type: "RETAILER" },
    allowedCommands: ["completeTransport", "reportDamage"],
    proofStatus: "verified",
    blockchainProof: {
      network: "Polygon Amoy mock",
      txId: "0xmock-polygon-tx-002",
      dataHash: "sha256:a923f75ce614c1f33d893abb2b412ac0",
      recordedAt: "2026-08-22T03:10:00.000Z"
    },
    timeline: [
      {
        eventId: "evt-011",
        eventType: "BATCH_CREATED",
        eventTime: "2026-08-15T03:00:00.000Z",
        summary: "Khởi tạo lô xoài cát.",
        proofStatus: "verified",
        actor: {
          userId: "user-farm-02",
          role: "FARM_STAFF",
          organizationId: "org-farm-02",
          organizationName: "Trang trại Nhà Bè"
        }
      },
      {
        eventId: "evt-012",
        eventType: "TRANSPORT_STARTED",
        eventTime: "2026-08-22T03:10:00.000Z",
        summary: "Shipment bắt đầu vận chuyển đến retailer đích.",
        proofStatus: "verified",
        actor: {
          userId: "user-transport-01",
          role: "TRANSPORTER",
          organizationId: "org-transport-01",
          organizationName: "Vận tải Sài Gòn"
        }
      }
    ]
  }
];

export function mockDashboard(): Dashboard {
  return {
    featuredBatch: mockBatches[0],
    stats: [
      { label: "Lô đang theo dõi", value: "12" },
      { label: "Bằng chứng đang chờ", value: "3" },
      { label: "Chuyến vận chuyển mở", value: "4" }
    ]
  };
}

export async function mockSubmitCommand(batchId: string, command: string) {
  await delay(250);
  return {
    ok: true,
    batchId,
    command,
    message: `Đã tiếp nhận thao tác ${command}. Khi nối máy chủ thật, hệ thống sẽ kiểm tra vai trò, đơn vị, quyền sở hữu và trạng thái hiện tại.`
  };
}

export async function mockSendSensorReading(request: SensorReadingRequest): Promise<SensorReadingResponse> {
  await delay(250);
  if (!Number.isFinite(request.temperature) || !Number.isFinite(request.humidity)) {
    return {
      status: "rejected",
      error: {
        status: 422,
        code: "VALIDATION_ERROR",
        message: "Nhiệt độ và độ ẩm phải là số hợp lệ."
      }
    };
  }

  return {
    status: "accepted",
    readingId: `reading-${Date.now()}`,
    digestPreview: {
      periodStart: request.timestampUtc,
      periodEnd: request.timestampUtc,
      readingCount: 1
    }
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
