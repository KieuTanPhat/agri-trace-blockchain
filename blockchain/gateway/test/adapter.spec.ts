import { describe, expect, it, vi } from "vitest";

import {
  FabricBlockchainAdapter,
  serializeTraceEnvelope,
  type TraceEventEnvelope,
} from "../src/adapter.js";
import type { GatewayConfig } from "../src/config.js";

const encoder = new TextEncoder();
const input: TraceEventEnvelope = {
  envelopeVersion: "3.0.0",
  nonce: "11111111-1111-4111-8111-111111111111",
  eventId: "11111111-1111-4111-8111-111111111111",
  entityType: "PRODUCTION_CYCLE",
  entityId: "55555555-5555-4555-8555-555555555555",
  cycleId: "55555555-5555-4555-8555-555555555555",
  eventType: "PRODUCTION_CYCLE_CREATED",
  eventTime: "2026-09-09T00:00:00.000Z",
  dataHash: "a".repeat(64),
  schemaVersion: "2.0.0",
  canonicalizationVersion: "RFC8785",
};

describe("FabricBlockchainAdapter", () => {
  it("maps every Backend operation to the locked chaincode transaction", async () => {
    const submitTransaction = vi.fn(async () =>
      encoder.encode('{"status":"SUBMITTED"}'),
    );
    const evaluateTransaction = vi.fn(async (name: string) =>
      encoder.encode(
        name === "GetExpectedHash" ? "a".repeat(64) : '{"ok":true}',
      ),
    );
    const getContract = vi.fn(() => ({
      submitTransaction,
      evaluateTransaction,
    }));
    const getNetwork = vi.fn(() => ({ getContract }));
    const config = {
      channelName: "agritrace",
      chaincodeName: "agritrace",
      contractName: "AgriTraceContract",
    } as GatewayConfig;
    const adapter = new FabricBlockchainAdapter(
      { getNetwork } as never,
      config,
    );

    await expect(adapter.submitTraceEvent(input)).resolves.toEqual({
      status: "SUBMITTED",
    });
    await expect(adapter.queryEvent("event-1")).resolves.toEqual({ ok: true });
    await expect(adapter.getProof("event-1")).resolves.toEqual({ ok: true });
    await expect(adapter.getExpectedHash("event-1")).resolves.toBe(
      "a".repeat(64),
    );
    await expect(adapter.queryEntityHistory("LOT", "lot-1")).resolves.toEqual({
      ok: true,
    });
    await expect(
      adapter.queryEntityHistoryPage("LOT", "lot-1", 50, "next"),
    ).resolves.toEqual({ ok: true });
    await expect(adapter.getEntityHead("LOT", "lot-1")).resolves.toEqual({
      ok: true,
    });
    await expect(adapter.healthCheck()).resolves.toEqual({ ok: true });

    expect(getNetwork).toHaveBeenCalledWith("agritrace");
    expect(getContract).toHaveBeenCalledWith("agritrace", "AgriTraceContract");
    expect(submitTransaction).toHaveBeenCalledWith(
      "RecordTraceEvent",
      serializeTraceEnvelope(input),
    );
    expect(evaluateTransaction.mock.calls.map(([name]) => name)).toEqual([
      "QueryEvent",
      "GetProof",
      "GetExpectedHash",
      "QueryEntityHistory",
      "QueryEntityHistoryPage",
      "GetEntityHead",
      "HealthCheck",
    ]);
    expect(evaluateTransaction).toHaveBeenCalledWith(
      "QueryEntityHistoryPage",
      "LOT",
      "lot-1",
      "50",
      "next",
    );
  });

  it.each([
    { actorContext: { actorAuthProof: "private" } },
    { payloadMetadata: { rawReadings: [1] } },
    { token: "private" },
    { nonce: "22222222-2222-4222-8222-222222222222" },
    { envelopeVersion: "2.0.0" },
    { eventId: "event-1" },
    { dataHash: "A".repeat(64) },
    { eventTime: "2026-02-30T00:00:00.000Z" },
    { eventTime: "2026-09-09T07:00:00+07:00" },
    { entityId: { toJSON: () => "55555555-5555-4555-8555-555555555555" } },
    { schemaVersion: "1.0.0" },
    { previousEventHash: "bad" },
  ])(
    "rejects incompatible or private input before submitting to Fabric",
    async (change) => {
      const submitTransaction = vi.fn();
      const adapter = new FabricBlockchainAdapter(
        {
          getNetwork: () => ({ getContract: () => ({ submitTransaction }) }),
        } as never,
        {
          channelName: "agritrace",
          chaincodeName: "agritrace",
          contractName: "AgriTraceContract",
        } as GatewayConfig,
      );
      await expect(
        adapter.submitTraceEvent({ ...input, ...change } as TraceEventEnvelope),
      ).rejects.toThrow("INVALID_INPUT");
      expect(submitTransaction).not.toHaveBeenCalled();
    },
  );
});
