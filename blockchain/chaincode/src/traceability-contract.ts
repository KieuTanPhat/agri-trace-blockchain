import { Context, Contract, Info, Returns, Transaction } from "fabric-contract-api";

import { contractError } from "./errors";
import { fromLedgerBytes, KEY_TYPES, timestampToIso, toLedgerBytes } from "./ledger";
import {
  SCHEMA_VERSION,
  type BlockchainProof,
  type EntityLedgerHead,
  type HealthResult,
  type StoredTraceEvent,
  type SubmitReceipt
} from "./types";
import { parseTraceEventInput, requireEntityId, requireEntityType, requireEventId } from "./validation";

@Info({
  title: "AgriTraceContract",
  description: "Immutable agricultural trace-event digest and proof registry"
})
export class AgriTraceContract extends Contract {
  public constructor() {
    super("AgriTraceContract");
  }

  @Transaction()
  @Returns("string")
  public async RecordTraceEvent(ctx: Context, inputJson: string): Promise<string> {
    this.assertTechnicalRelayer(ctx);
    const input = parseTraceEventInput(inputJson);
    const eventKey = ctx.stub.createCompositeKey(KEY_TYPES.event, [input.eventId]);
    if ((await ctx.stub.getState(eventKey)).length > 0) {
      throw contractError("DUPLICATE_EVENT", `eventId ${input.eventId} already exists`);
    }

    const headKey = ctx.stub.createCompositeKey(KEY_TYPES.entityHead, [input.entityType, input.entityId]);
    const existingHeadBytes = await ctx.stub.getState(headKey);
    const existingHead = existingHeadBytes.length > 0
      ? fromLedgerBytes<EntityLedgerHead>(existingHeadBytes, `entity ${input.entityType}/${input.entityId}`)
      : undefined;
    if (existingHead && input.previousEventHash !== existingHead.lastDataHash) {
      throw contractError("HASH_CHAIN_CONFLICT", "previousEventHash does not match the current entity head");
    }
    if (!existingHead && input.previousEventHash) {
      throw contractError("HASH_CHAIN_CONFLICT", "genesis event must not declare previousEventHash");
    }

    const txId = ctx.stub.getTxID();
    const recordedAt = timestampToIso(ctx.stub.getTxTimestamp());
    const channelId = ctx.stub.getChannelID();
    const submitterMspId = ctx.clientIdentity.getMSPID();
    const submitterId = ctx.clientIdentity.getID();
    const event: StoredTraceEvent = {
      docType: "traceEvent",
      ...input,
      txId,
      channelId,
      recordedAt,
      submitterMspId,
      submitterId
    };
    const proof: BlockchainProof = {
      docType: "blockchainProof",
      eventId: input.eventId,
      entityType: input.entityType,
      entityId: input.entityId,
      cycleId: input.cycleId,
      lotId: input.lotId,
      eventType: input.eventType,
      eventTime: input.eventTime,
      dataHash: input.dataHash,
      previousEventHash: input.previousEventHash,
      schemaVersion: input.schemaVersion,
      canonicalizationVersion: input.canonicalizationVersion,
      txId,
      channelId,
      recordedAt,
      submitterMspId,
      submitterId
    };
    const head: EntityLedgerHead = {
      docType: "entityHead",
      entityType: input.entityType,
      entityId: input.entityId,
      eventCount: (existingHead?.eventCount ?? 0) + 1,
      firstEventId: existingHead?.firstEventId ?? input.eventId,
      lastEventId: input.eventId,
      lastEventTime: input.eventTime,
      lastDataHash: input.dataHash,
      updatedAt: recordedAt
    };
    const proofKey = ctx.stub.createCompositeKey(KEY_TYPES.proof, [input.eventId]);
    const historyKey = ctx.stub.createCompositeKey(KEY_TYPES.entityEvent, [
      input.entityType, input.entityId, recordedAt, txId, input.eventId
    ]);

    await ctx.stub.putState(eventKey, toLedgerBytes(event));
    await ctx.stub.putState(proofKey, toLedgerBytes(proof));
    await ctx.stub.putState(headKey, toLedgerBytes(head));
    // Store the event snapshot in the history index. New history queries can
    // read the iterator value directly instead of issuing one getState call per
    // event. The query code remains backward compatible with old eventId-only
    // index values.
    await ctx.stub.putState(historyKey, toLedgerBytes(event));
    await ctx.stub.setEvent("TraceEventRecorded", toLedgerBytes(proof));

    const receipt: SubmitReceipt = {
      status: "SUBMITTED",
      eventId: input.eventId,
      entityType: input.entityType,
      entityId: input.entityId,
      dataHash: input.dataHash,
      txId,
      recordedAt,
      submitterMspId
    };
    return this.stringify(receipt);
  }

  @Transaction(false)
  @Returns("string")
  public async QueryEvent(ctx: Context, eventId: string): Promise<string> {
    const key = ctx.stub.createCompositeKey(KEY_TYPES.event, [requireEventId(eventId)]);
    return this.stringify(fromLedgerBytes<StoredTraceEvent>(await ctx.stub.getState(key), `event ${eventId}`));
  }

  @Transaction(false)
  @Returns("string")
  public async GetProof(ctx: Context, eventId: string): Promise<string> {
    const key = ctx.stub.createCompositeKey(KEY_TYPES.proof, [requireEventId(eventId)]);
    return this.stringify(fromLedgerBytes<BlockchainProof>(await ctx.stub.getState(key), `proof ${eventId}`));
  }

  @Transaction(false)
  @Returns("string")
  public async GetExpectedHash(ctx: Context, eventId: string): Promise<string> {
    return (JSON.parse(await this.GetProof(ctx, eventId)) as BlockchainProof).dataHash;
  }

  @Transaction(false)
  @Returns("string")
  public async GetEntityHead(ctx: Context, entityType: string, entityId: string): Promise<string> {
    const safeType = requireEntityType(entityType);
    const safeId = requireEntityId(entityId);
    const key = ctx.stub.createCompositeKey(KEY_TYPES.entityHead, [safeType, safeId]);
    return this.stringify(fromLedgerBytes<EntityLedgerHead>(await ctx.stub.getState(key), `entity ${safeType}/${safeId}`));
  }

  @Transaction(false)
  @Returns("string")
  public async QueryEntityHistory(ctx: Context, entityType: string, entityId: string): Promise<string> {
    const safeType = requireEntityType(entityType);
    const safeId = requireEntityId(entityId);
    const iterator = await ctx.stub.getStateByPartialCompositeKey(KEY_TYPES.entityEvent, [safeType, safeId]);
    const events: StoredTraceEvent[] = [];
    try {
      while (events.length < 100) {
        const item = await iterator.next();
        if (item.value?.value) {
          events.push(await this.readHistoryValue(ctx, item.value.value));
        }
        if (item.done) break;
      }
    } finally {
      await iterator.close();
    }
    if (events.length === 0) throw contractError("NOT_FOUND", `entity history ${safeType}/${safeId} does not exist`);
    return this.stringify(events);
  }

  @Transaction(false)
  @Returns("string")
  public async QueryEntityHistoryPage(
    ctx: Context,
    entityType: string,
    entityId: string,
    pageSize: string,
    bookmark: string
  ): Promise<string> {
    const safeType = requireEntityType(entityType);
    const safeId = requireEntityId(entityId);
    const requestedSize = Number(pageSize);
    if (!Number.isInteger(requestedSize) || requestedSize < 1 || requestedSize > 500) {
      throw contractError("INVALID_INPUT", "pageSize must be an integer between 1 and 500");
    }
    const result = await ctx.stub.getStateByPartialCompositeKeyWithPagination(
      KEY_TYPES.entityEvent,
      [safeType, safeId],
      requestedSize,
      bookmark
    );
    const events: StoredTraceEvent[] = [];
    try {
      while (true) {
        const item = await result.iterator.next();
        if (item.value?.value) events.push(await this.readHistoryValue(ctx, item.value.value));
        if (item.done) break;
      }
    } finally {
      await result.iterator.close();
    }
    return this.stringify({
      records: events,
      bookmark: result.metadata.bookmark,
      fetchedRecordsCount: result.metadata.fetchedRecordsCount
    });
  }

  @Transaction(false)
  @Returns("string")
  public async HealthCheck(_ctx: Context): Promise<string> {
    const result: HealthResult = { status: "OK", contract: "AgriTraceContract", schemaVersion: SCHEMA_VERSION };
    return this.stringify(result);
  }

  private assertTechnicalRelayer(ctx: Context): void {
    if (!ctx.clientIdentity.assertAttributeValue("app.role", "relayer")) {
      throw contractError("UNAUTHORIZED_RELAYER", "Fabric identity must have app.role=relayer");
    }
  }

  private async readHistoryValue(ctx: Context, value: Uint8Array): Promise<StoredTraceEvent> {
    const raw = Buffer.from(value).toString("utf8");
    try {
      const parsed = JSON.parse(raw) as StoredTraceEvent;
      if (parsed.docType === "traceEvent") return parsed;
    } catch {
      // Legacy history entries stored only eventId and are resolved below.
    }
    const eventKey = ctx.stub.createCompositeKey(KEY_TYPES.event, [raw]);
    return fromLedgerBytes<StoredTraceEvent>(await ctx.stub.getState(eventKey), `event ${raw}`);
  }

  private stringify(value: unknown): string {
    return toLedgerBytes(value).toString("utf8");
  }
}
