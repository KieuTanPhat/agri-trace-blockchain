import { describe, expect, it } from "vitest";

import { KEY_TYPES } from "../src/ledger";
import { AgriTraceContract } from "../src/traceability-contract";
import type { BlockchainProof, EntityLedgerHead, StoredTraceEvent, SubmitReceipt } from "../src/types";
import { validInput } from "./fixtures";
import { createFakeContext } from "./helpers/fake-context";

describe("AgriTraceContract", () => {
  it("records an entity event atomically and returns a receipt", async () => {
    const contract = new AgriTraceContract();
    const { ctx, stub } = createFakeContext();
    const input = validInput();
    const receipt = JSON.parse(await contract.RecordTraceEvent(ctx, JSON.stringify(input))) as SubmitReceipt;

    expect(receipt).toMatchObject({
      status: "SUBMITTED", eventId: input.eventId, entityType: input.entityType,
      entityId: input.entityId, dataHash: input.dataHash, txId: "tx-0001"
    });
    expect(stub.state.size).toBe(4);
    expect(stub.events[0].name).toBe("TraceEventRecorded");

    const event = JSON.parse(await contract.QueryEvent(ctx, input.eventId)) as StoredTraceEvent;
    const proof = JSON.parse(await contract.GetProof(ctx, input.eventId)) as BlockchainProof;
    const head = JSON.parse(await contract.GetEntityHead(ctx, input.entityType, input.entityId)) as EntityLedgerHead;
    expect(event.actorContext).toEqual(input.actorContext);
    expect(proof.dataHash).toBe(input.dataHash);
    expect(head).toMatchObject({ eventCount: 1, firstEventId: input.eventId, lastDataHash: input.dataHash });
    expect(await contract.GetExpectedHash(ctx, input.eventId)).toBe(input.dataHash);
    expect(JSON.parse(await contract.QueryEntityHistory(ctx, input.entityType, input.entityId))).toEqual([event]);
  });

  it("appends multiple events and validates an optional previous hash", async () => {
    const contract = new AgriTraceContract();
    const { ctx, stub } = createFakeContext();
    const first = validInput();
    await contract.RecordTraceEvent(ctx, JSON.stringify(first));
    stub.txId = "tx-0002";
    const second = validInput({
      eventId: "44444444-4444-4444-8444-444444444444",
      eventType: "PLANTING_RECORDED",
      dataHash: "c".repeat(64),
      previousEventHash: first.dataHash
    });
    await contract.RecordTraceEvent(ctx, JSON.stringify(second));
    expect(JSON.parse(await contract.QueryEntityHistory(ctx, first.entityType, first.entityId))).toHaveLength(2);
    await expect(contract.RecordTraceEvent(ctx, JSON.stringify(validInput({
      eventId: "66666666-6666-4666-8666-666666666666",
      dataHash: "d".repeat(64),
      previousEventHash: "e".repeat(64)
    })))).rejects.toThrow("HASH_CHAIN_CONFLICT");
  });

  it("rejects unauthorized relayers and duplicate event IDs", async () => {
    const contract = new AgriTraceContract();
    const blocked = createFakeContext();
    blocked.clientIdentity.relayer = false;
    await expect(contract.RecordTraceEvent(blocked.ctx, JSON.stringify(validInput()))).rejects.toThrow("UNAUTHORIZED_RELAYER");

    const allowed = createFakeContext();
    await contract.RecordTraceEvent(allowed.ctx, JSON.stringify(validInput()));
    await expect(contract.RecordTraceEvent(allowed.ctx, JSON.stringify(validInput()))).rejects.toThrow("DUPLICATE_EVENT");
  });

  it("returns stable health metadata", async () => {
    const contract = new AgriTraceContract();
    const { ctx } = createFakeContext();
    expect(JSON.parse(await contract.HealthCheck(ctx))).toEqual({
      contract: "AgriTraceContract", schemaVersion: "2.0.0", status: "OK"
    });
  });

  it("rejects missing records and invalid identifiers", async () => {
    const contract = new AgriTraceContract();
    const { ctx } = createFakeContext();
    const missing = "99999999-9999-4999-8999-999999999999";
    await expect(contract.QueryEvent(ctx, missing)).rejects.toThrow("NOT_FOUND");
    await expect(contract.GetProof(ctx, missing)).rejects.toThrow("NOT_FOUND");
    await expect(contract.GetEntityHead(ctx, "LOT", missing)).rejects.toThrow("NOT_FOUND");
    await expect(contract.QueryEntityHistory(ctx, "LOT", missing)).rejects.toThrow("NOT_FOUND");
    await expect(contract.GetEntityHead(ctx, "BATCH", missing)).rejects.toThrow("INVALID_INPUT");
  });

  it("uses composite-key namespaces for every persisted object", async () => {
    const contract = new AgriTraceContract();
    const { ctx, stub } = createFakeContext();
    await contract.RecordTraceEvent(ctx, JSON.stringify(validInput()));
    for (const namespace of Object.values(KEY_TYPES)) {
      expect([...stub.state.keys()].some((key) => key.startsWith(`\u0000${namespace}\u0000`))).toBe(true);
    }
  });
});
