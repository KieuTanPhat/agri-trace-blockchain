import type { PublicLot } from "../src/api/trace";

// Test-only public projection. Never imported by app/ or src/.
export const TOKEN = "test_trace_token_0000000000000001";
export function publicLot(patch: Partial<PublicLot> = {}): PublicLot {
  return {
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
