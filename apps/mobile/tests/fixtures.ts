import type { PublicLot } from "../src/api/trace";

// Test-only public projection. Never imported by app/ or src/.
export const TOKEN = "test_trace_token_0000000000000001";
export function publicLot(patch: Partial<PublicLot> = {}): PublicLot {
  return {
    originType: "HARVEST",
    processing: null,
    lotId: "11111111-1111-4111-8111-111111111111",
    lotCode: "LOT-TEST-01",
    traceToken: TOKEN,
    productName: "Rau cải thử nghiệm",
    unit: "kg",
    initialQuantity: 100,
    availableQuantity: 90,
    harvestTime: "2026-10-15T07:00:00.000Z",
    expiryDate: "2026-10-25",
    currentState: "HARVESTED",
    isExpired: false,
    quantityReconciled: true,
    stateReconciled: true,
    proofStatus: "PENDING",
    farmOrg: {
      organizationId: "22222222-2222-4222-8222-222222222222",
      name: "Nông trại kiểm thử",
      type: "FARM",
    },
    productionCycle: {
      cycleId: "33333333-3333-4333-8333-333333333333",
      cycleCode: "CYCLE-TEST",
      currentState: "GROWING",
      startDate: "2026-09-01T00:00:00.000Z",
    },
    sensorEvidence: {
      status: "NO_DATA",
      readingCount: 0,
      lateReadingCount: 0,
      digestHash: null,
      finalizedAt: null,
      periodStart: null,
      periodEnd: null,
    },
    shipment: null,
    certificates: [],
    timeline: [],
    warnings: [],
    allowedCommands: [],
    ...patch,
  };
}

export function processingLot(): PublicLot {
  return publicLot({
    productName: "Rau sấy thử nghiệm",
    harvestTime: "2026-10-25T07:00:00.000Z",
    farmOrg: {
      ...publicLot().farmOrg,
      name: "Đơn vị chế biến thử nghiệm",
      type: "PROCESSOR",
    },
    originType: "TRANSFORMATION",
    productionCycle: null,
    processing: {
      code: "PROCESS-TEST",
      processType: "DRYING",
      processorName: "Đơn vị chế biến thử nghiệm",
      completedAt: "2026-10-25T07:00:00.000Z",
      inputTotal: 10,
      outputTotal: 8,
      lossTotal: 2,
      baseUnit: "kg",
      inputs: [
        {
          lotCode: "INPUT-TEST",
          productName: "Rau cải",
          quantity: 10,
          unit: "kg",
          originType: "HARVEST",
          producerName: "Nông trại thử nghiệm",
          harvestTime: null,
        },
      ],
    },
    sensorEvidence: { ...publicLot().sensorEvidence, status: "NOT_APPLICABLE" },
  });
}

export function distributionLot(): PublicLot {
  return publicLot({
    proofStatus: "VERIFIED",
    notices: [
      {
        kind: "WARNING",
        message: "Mã QR đã bị nền tảng AgriTrace khóa: Đang đối soát",
        createdAt: "2026-10-25T07:00:00.000Z",
      },
    ],
    productionWarnings: [
      "Theo nhật ký khai báo, thu hoạch còn trong thời gian cách ly. Đây không phải kết quả kiểm nghiệm.",
    ],
    distributionJourney: [
      {
        senderName: "Nông trại thử nghiệm",
        carrierName: "Đơn vị vận chuyển",
        receiverName: "Nhà phân phối",
        quantity: "1.123",
        unit: "kg",
        status: "DELIVERED",
        recordedAt: "2026-10-25T07:00:00.000Z",
        receivedQuantity: "1.000",
        pendingQuantity: "0.123",
        returnedQuantity: "0.000",
        custodyStage: "RECEIVER_WITH_REMAINDER",
      },
    ],
  });
}
