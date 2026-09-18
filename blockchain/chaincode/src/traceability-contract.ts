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
    if (input.previousEventHash && input.previousEventHash !== existingHead?.lastDataHash) {
      throw contractError("HASH_CHAIN_CONFLICT", "previousEventHash does not match the current entity head");
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
    await ctx.stub.putState(historyKey, Buffer.from(input.eventId, "utf8"));
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
      while (true) {
        const item = await iterator.next();
        if (item.value?.value) {
          const eventId = Buffer.from(item.value.value).toString("utf8");
          const eventKey = ctx.stub.createCompositeKey(KEY_TYPES.event, [eventId]);
          events.push(fromLedgerBytes<StoredTraceEvent>(await ctx.stub.getState(eventKey), `event ${eventId}`));
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
  public async HealthCheck(_ctx: Context): Promise<string> {
    const result: HealthResult = { status: "OK", contract: "AgriTraceContract", schemaVersion: SCHEMA_VERSION };
    return this.stringify(result);
  }

  private assertTechnicalRelayer(ctx: Context): void {
    if (!ctx.clientIdentity.assertAttributeValue("app.role", "relayer")) {
      throw contractError("UNAUTHORIZED_RELAYER", "Fabric identity must have app.role=relayer");
    }
  }

  private stringify(value: unknown): string {
    return toLedgerBytes(value).toString("utf8");
  }
}
