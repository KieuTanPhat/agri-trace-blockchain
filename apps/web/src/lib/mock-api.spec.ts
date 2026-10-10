import { describe, expect, it } from "vitest";
import { mockLots, mockPublicTrace } from "./mock-api";
import type { LotTrace } from "./types";

describe("public trace mock projection", () => {
  it("keeps private fields and commands in the internal mock while returning the public shipment and actor", () => {
    const lot: LotTrace = {
      ...mockLots[0],
      lotId: "projection-lot",
      lotCode: "PROJECTION-LOT",
      traceToken: "projection-token",
      version: 7,
      shipment: {
        shipmentId: "private-shipment",
        version: 3,
        status: "CREATED",
        transporterOrgId: "private-transporter",
        retailerOrgId: "private-retailer",
        origin: "Farm",
        destination: "Retailer",
        shippedQuantity: 120,
        receivedQuantity: null,
        rejectedQuantity: null,
      },
    };
    mockLots.push(lot);
    try {
      const before = structuredClone(lot);
      const trace = mockPublicTrace(lot.traceToken!);

      expect(trace).toMatchObject({
        lotId: lot.lotId,
        traceToken: lot.traceToken,
        allowedCommands: [],
        shipment: {
          status: "CREATED",
          origin: "Farm",
          destination: "Retailer",
          pickupTime: null,
          arrivalTime: null,
          receivedTime: null,
        },
      });
      expect(Object.keys(trace!).sort()).toEqual(
        [
          "allowedCommands",
          "availableQuantity",
          "blockchainProof",
          "certificates",
          "currentState",
          "farmOrg",
          "harvestTime",
          "initialQuantity",
          "lotCode",
          "lotId",
          "productName",
          "productionCycle",
          "proofStatus",
          "shipment",
          "timeline",
          "traceToken",
          "unit",
          "expiryDate",
          "isExpired",
          "quantityReconciled",
          "stateReconciled",
          "warnings",
          "sensorEvidence",
        ].sort(),
      );
      expect(Object.keys(trace!.shipment!).sort()).toEqual(
        [
          "status",
          "origin",
          "destination",
          "pickupTime",
          "arrivalTime",
          "receivedTime",
        ].sort(),
      );
      for (const event of trace!.timeline) {
        expect(event.actor).toEqual({
          role: "SYSTEM_ACTOR",
          organizationName: "AgriTrace",
        });
      }
      expect(mockPublicTrace(lot.lotId)).toEqual(trace);
      expect(mockPublicTrace(lot.lotCode)).toEqual(trace);
      expect(lot).toEqual(before);
    } finally {
      mockLots.pop();
    }
  });

  it("represents absent shipment and start date as null, and returns null for an unknown token", () => {
    const trace = mockPublicTrace(mockLots[1].lotId);

    expect(trace?.shipment).toBeNull();
    expect(trace?.productionCycle.startDate).toBeNull();
    expect(trace?.certificates).toEqual([]);
    expect(mockPublicTrace("missing-token")).toBeNull();
  });
});
