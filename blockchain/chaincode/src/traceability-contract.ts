import { Context, Contract, Info, Returns, Transaction } from "fabric-contract-api";

import { contractError } from "./errors";
import { fromLedgerBytes, KEY_TYPES, timestampToIso, toLedgerBytes } from "./ledger";
import {
  INITIAL_BATCH_STATE,
  SCHEMA_VERSION,
  type BatchLedgerState,
  type BlockchainProof,
  type HealthResult,
  type StoredTraceEvent,
  type SubmitReceipt
} from "./types";
import { parseTraceEventInput, requireBatchId, requireEventId } from "./validation";

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

    const batchKey = ctx.stub.createCompositeKey(KEY_TYPES.batch, [input.batchId]);
    if ((await ctx.stub.getState(batchKey)).length > 0) {
      throw contractError("DUPLICATE_BATCH", `batchId ${input.batchId} already exists`);
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
      batchId: input.batchId,
      dataHash: input.dataHash,
      schemaVersion: input.schemaVersion,
      canonicalizationVersion: input.canonicalizationVersion,
      txId,
      channelId,
      recordedAt,
      submitterMspId,
      submitterId
    };
    const batch: BatchLedgerState = {
      docType: "batchState",
      batchId: input.batchId,
      currentState: INITIAL_BATCH_STATE,
      eventCount: 1,
      createdEventId: input.eventId,
      lastEventId: input.eventId,
      lastEventTime: input.eventTime,
      updatedAt: recordedAt
    };
    const proofKey = ctx.stub.createCompositeKey(KEY_TYPES.proof, [input.eventId]);
    const historyKey = ctx.stub.createCompositeKey(KEY_TYPES.batchEvent, [
      input.batchId,
      recordedAt,
      txId,
      input.eventId
    ]);

    await ctx.stub.putState(eventKey, toLedgerBytes(event));
    await ctx.stub.putState(proofKey, toLedgerBytes(proof));
    await ctx.stub.putState(batchKey, toLedgerBytes(batch));
    await ctx.stub.putState(historyKey, Buffer.from(input.eventId, "utf8"));
    await ctx.stub.setEvent("TraceEventRecorded", toLedgerBytes(proof));

    const receipt: SubmitReceipt = {
      status: "SUBMITTED",
      eventId: input.eventId,
      batchId: input.batchId,
      dataHash: input.dataHash,
      txId,
      recordedAt,
      submitterMspId,
      currentState: INITIAL_BATCH_STATE
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
    const proof = JSON.parse(await this.GetProof(ctx, eventId)) as BlockchainProof;
    return proof.dataHash;
  }

  @Transaction(false)
  @Returns("string")
  public async GetBatchState(ctx: Context, batchId: string): Promise<string> {
    const key = ctx.stub.createCompositeKey(KEY_TYPES.batch, [requireBatchId(batchId)]);
    return this.stringify(fromLedgerBytes<BatchLedgerState>(await ctx.stub.getState(key), `batch ${batchId}`));
  }

  @Transaction(false)
  @Returns("string")
  public async QueryBatchHistory(ctx: Context, batchId: string): Promise<string> {
    const safeBatchId = requireBatchId(batchId);
    const iterator = await ctx.stub.getStateByPartialCompositeKey(KEY_TYPES.batchEvent, [safeBatchId]);
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
    if (events.length === 0) {
      throw contractError("NOT_FOUND", `batch history ${safeBatchId} does not exist`);
    }
    return this.stringify(events);
  }

  @Transaction(false)
  @Returns("string")
  public async HealthCheck(_ctx: Context): Promise<string> {
    const result: HealthResult = {
      status: "OK",
      contract: "AgriTraceContract",
      schemaVersion: SCHEMA_VERSION
    };
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
