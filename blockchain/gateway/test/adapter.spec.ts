import { describe, expect, it, vi } from "vitest";

import { FabricBlockchainAdapter, type TraceEventInput } from "../src/adapter.js";
import type { GatewayConfig } from "../src/config.js";

const encoder = new TextEncoder();

describe("FabricBlockchainAdapter", () => {
  it("maps every Backend operation to the locked chaincode transaction", async () => {
    const submitTransaction = vi.fn(async () => encoder.encode('{"status":"SUBMITTED"}'));
    const evaluateTransaction = vi.fn(async (name: string) =>
      encoder.encode(name === "GetExpectedHash" ? "a".repeat(64) : '{"ok":true}')
    );
    const getContract = vi.fn(() => ({ submitTransaction, evaluateTransaction }));
    const getNetwork = vi.fn(() => ({ getContract }));
    const config = {
      channelName: "agritrace",
      chaincodeName: "agritrace",
      contractName: "AgriTraceContract"
    } as GatewayConfig;
    const adapter = new FabricBlockchainAdapter({ getNetwork } as never, config);
    const input = { eventId: "event-1" } as TraceEventInput;

    await expect(adapter.submitTraceEvent(input)).resolves.toEqual({ status: "SUBMITTED" });
    await expect(adapter.queryEvent("event-1")).resolves.toEqual({ ok: true });
    await expect(adapter.getProof("event-1")).resolves.toEqual({ ok: true });
    await expect(adapter.getExpectedHash("event-1")).resolves.toBe("a".repeat(64));
    await expect(adapter.queryBatchHistory("batch-1")).resolves.toEqual({ ok: true });
    await expect(adapter.getBatchState("batch-1")).resolves.toEqual({ ok: true });
    await expect(adapter.healthCheck()).resolves.toEqual({ ok: true });

    expect(getNetwork).toHaveBeenCalledWith("agritrace");
    expect(getContract).toHaveBeenCalledWith("agritrace", "AgriTraceContract");
    expect(submitTransaction).toHaveBeenCalledWith("RecordTraceEvent", JSON.stringify(input));
    expect(evaluateTransaction.mock.calls.map(([name]) => name)).toEqual([
      "QueryEvent",
      "GetProof",
      "GetExpectedHash",
      "QueryBatchHistory",
      "GetBatchState",
      "HealthCheck"
    ]);
  });
});
