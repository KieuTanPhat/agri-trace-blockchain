import { describe, expect, it } from "vitest";

import { KEY_TYPES } from "../src/ledger";
import { AgriTraceContract } from "../src/traceability-contract";
import type { BatchLedgerState, BlockchainProof, StoredTraceEvent, SubmitReceipt } from "../src/types";
import { validInput } from "./fixtures";
import { createFakeContext } from "./helpers/fake-context";

describe("AgriTraceContract", () => {
  it("records BATCH_CREATED atomically and returns a receipt", async () => {
    const contract = new AgriTraceContract();
    const { ctx, stub } = createFakeContext();
    const input = validInput();

    const receipt = JSON.parse(await contract.RecordTraceEvent(ctx, JSON.stringify(input))) as SubmitReceipt;

    expect(receipt).toMatchObject({
      status: "SUBMITTED",
      eventId: input.eventId,
      batchId: input.batchId,
      dataHash: input.dataHash,
      txId: "tx-0001",
      submitterMspId: "Org1MSP",
      currentState: "CREATED"
    });
    expect(stub.state.size).toBe(4);
    expect(stub.events).toHaveLength(1);
    expect(stub.events[0].name).toBe("TraceEventRecorded");

    const event = JSON.parse(await contract.QueryEvent(ctx, input.eventId)) as StoredTraceEvent;
    const proof = JSON.parse(await contract.GetProof(ctx, input.eventId)) as BlockchainProof;
    const batch = JSON.parse(await contract.GetBatchState(ctx, input.batchId)) as BatchLedgerState;
    expect(event.actorContext).toEqual(input.actorContext);
    expect(event.recordedAt).toBe("2026-09-06T16:00:00.123Z");
    expect(proof.dataHash).toBe(input.dataHash);
    expect(batch).toMatchObject({ currentState: "CREATED", eventCount: 1, createdEventId: input.eventId });
    expect(await contract.GetExpectedHash(ctx, input.eventId)).toBe(input.dataHash);
    expect(JSON.parse(await contract.QueryBatchHistory(ctx, input.batchId))).toEqual([event]);
  });

  it("rejects a non-relayer before touching state", async () => {
    const contract = new AgriTraceContract();
    const { ctx, stub, clientIdentity } = createFakeContext();
    clientIdentity.relayer = false;

    await expect(contract.RecordTraceEvent(ctx, JSON.stringify(validInput()))).rejects.toThrow(
      "UNAUTHORIZED_RELAYER"
    );
    expect(stub.state.size).toBe(0);
  });

  it("rejects duplicate event IDs", async () => {
    const contract = new AgriTraceContract();
    const { ctx } = createFakeContext();
    const input = validInput();
    await contract.RecordTraceEvent(ctx, JSON.stringify(input));

    await expect(contract.RecordTraceEvent(ctx, JSON.stringify(input))).rejects.toThrow("DUPLICATE_EVENT");
  });

  it("rejects a second BATCH_CREATED event for the same batch", async () => {
    const contract = new AgriTraceContract();
    const { ctx, stub } = createFakeContext();
    const input = validInput();
    await contract.RecordTraceEvent(ctx, JSON.stringify(input));
    const second = validInput({ eventId: "44444444-4444-4444-8444-444444444444" });
    stub.txId = "tx-0002";

    await expect(contract.RecordTraceEvent(ctx, JSON.stringify(second))).rejects.toThrow("DUPLICATE_BATCH");
  });

  it("returns stable health metadata", async () => {
    const contract = new AgriTraceContract();
    const { ctx } = createFakeContext();
    expect(JSON.parse(await contract.HealthCheck(ctx))).toEqual({
      contract: "AgriTraceContract",
      schemaVersion: "1.0.0",
      status: "OK"
    });
  });

  it("rejects missing query records and invalid identifiers", async () => {
    const contract = new AgriTraceContract();
    const { ctx } = createFakeContext();

    const missingEvent = "99999999-9999-4999-8999-999999999999";
    await expect(contract.QueryEvent(ctx, missingEvent)).rejects.toThrow("NOT_FOUND");
    await expect(contract.GetProof(ctx, missingEvent)).rejects.toThrow("NOT_FOUND");
    await expect(contract.GetBatchState(ctx, "MISSING")).rejects.toThrow("NOT_FOUND");
    await expect(contract.QueryBatchHistory(ctx, "MISSING")).rejects.toThrow("NOT_FOUND");
    await expect(contract.QueryEvent(ctx, "")).rejects.toThrow("INVALID_INPUT");
    await expect(contract.QueryEvent(ctx, "x".repeat(129))).rejects.toThrow("INVALID_INPUT");
    await expect(contract.QueryEvent(ctx, "bad\u0000id")).rejects.toThrow("INVALID_INPUT");
    await expect(contract.GetBatchState(ctx, "bad batch")).rejects.toThrow("INVALID_INPUT");
  });

  it("uses composite-key namespaces for every persisted object", async () => {
    const contract = new AgriTraceContract();
    const { ctx, stub } = createFakeContext();
    const input = validInput();
    await contract.RecordTraceEvent(ctx, JSON.stringify(input));

    expect([...stub.state.keys()].some((key) => key.startsWith(`\u0000${KEY_TYPES.event}\u0000`))).toBe(true);
    expect([...stub.state.keys()].some((key) => key.startsWith(`\u0000${KEY_TYPES.proof}\u0000`))).toBe(true);
    expect([...stub.state.keys()].some((key) => key.startsWith(`\u0000${KEY_TYPES.batch}\u0000`))).toBe(true);
    expect([...stub.state.keys()].some((key) => key.startsWith(`\u0000${KEY_TYPES.batchEvent}\u0000`))).toBe(true);
  });
});
