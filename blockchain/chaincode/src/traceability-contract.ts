import {
  Context,
  Contract,
  Info,
  Returns,
  Transaction,
} from "fabric-contract-api";

import {
  readBindingEvent,
  readBindingHead,
  readBindingHistoryPage,
  readBindingProof,
  recordBindingEvent,
  recordSignedBindingEvent,
} from "./binding-events";
import { contractError } from "./errors";
import { GOVERNANCE_DIGEST } from "./governance";
import {
  approveChange,
  callerRole,
  executeChange,
  getBinding,
  getChannelPolicy,
  getCredential,
  getFence,
  getPermission,
  getProposal,
  getSigningKey,
  proposeChange,
} from "./registry";
import { SIGNING_PROTOCOL } from "./signing";
import { recordConnectionProbe, readConnectionProbe } from './connection-probes';
import { requireHash, requireName, requireUuid } from "./binding";
import {
  fromLedgerBytes,
  KEY_TYPES,
  timestampToIso,
  toLedgerBytes,
} from "./ledger";
import {
  SCHEMA_VERSION,
  ENVELOPE_VERSION,
  type BlockchainProof,
  type EntityLedgerHead,
  type HealthResult,
  type StoredTraceEvent,
  type SubmitReceipt,
} from "./types";
import {
  parseTraceEventInput,
  requireEntityId,
  requireEntityType,
  requireEventId,
} from "./validation";

@Info({
  title: "AgriTraceContract",
  description: "Immutable agricultural trace-event digest and proof registry",
})
export class AgriTraceContract extends Contract {
  public constructor() {
    super("AgriTraceContract");
  }

  @Transaction()
  @Returns("string")
  public async RecordTraceEvent(
    ctx: Context,
    inputJson: string,
  ): Promise<string> {
    this.assertTechnicalRelayer(ctx);
    // A strict-B channel never accepts the release-A writer entrypoint unless
    // its reviewed bootstrap policy says so (downgrade protection).
    const policy = await getChannelPolicy(ctx);
    if (policy && !policy.allowLegacyV3Writes)
      throw contractError(
        "LEGACY_WRITES_DISABLED",
        "this channel only accepts binding-protocol writes",
      );
    const input = parseTraceEventInput(inputJson);
    const eventKey = ctx.stub.createCompositeKey(KEY_TYPES.event, [
      input.eventId,
    ]);
    const previousBytes = await ctx.stub.getState(eventKey);
    if (previousBytes.length > 0) {
      const previous = fromLedgerBytes<StoredTraceEvent>(
        previousBytes,
        `event ${input.eventId}`,
      );
      const fields = [
        "eventId",
        "entityType",
        "entityId",
        "cycleId",
        "lotId",
        "eventType",
        "eventTime",
        "dataHash",
        "previousEventHash",
        "schemaVersion",
        "canonicalizationVersion",
      ] as const;
      if (
        fields.some(
          (field) => (previous[field] ?? null) !== (input[field] ?? null),
        ) ||
        (previous.envelopeVersion &&
          (previous.envelopeVersion !== input.envelopeVersion ||
            previous.nonce !== input.nonce))
      )
        throw contractError(
          "DUPLICATE_EVENT_CONFLICT",
          "eventId already exists with a different public tuple",
        );
      throw contractError(
        "DUPLICATE_EVENT",
        `eventId ${input.eventId} already exists`,
      );
    }

    const headKey = ctx.stub.createCompositeKey(KEY_TYPES.entityHead, [
      input.entityType,
      input.entityId,
    ]);
    const existingHeadBytes = await ctx.stub.getState(headKey);
    const existingHead =
      existingHeadBytes.length > 0
        ? fromLedgerBytes<EntityLedgerHead>(
            existingHeadBytes,
            `entity ${input.entityType}/${input.entityId}`,
          )
        : undefined;
    if (existingHead && input.previousEventHash !== existingHead.lastDataHash) {
      throw contractError(
        "HASH_CHAIN_CONFLICT",
        "previousEventHash does not match the current entity head",
      );
    }
    if (!existingHead && input.previousEventHash) {
      throw contractError(
        "HASH_CHAIN_CONFLICT",
        "genesis event must not declare previousEventHash",
      );
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
      submitterId,
    };
    const proof: BlockchainProof = {
      envelopeVersion: input.envelopeVersion,
      nonce: input.nonce,
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
      submitterId,
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
      updatedAt: recordedAt,
    };
    const proofKey = ctx.stub.createCompositeKey(KEY_TYPES.proof, [
      input.eventId,
    ]);
    const historyKey = ctx.stub.createCompositeKey(KEY_TYPES.entityEvent, [
      input.entityType,
      input.entityId,
      recordedAt,
      txId,
      input.eventId,
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
      submitterMspId,
    };
    return this.stringify(receipt);
  }

  @Transaction()
  @Returns("string")
  public async RecordBindingEvent(
    ctx: Context,
    eventJson: string,
    deliveryJson: string,
  ): Promise<string> {
    return this.stringify((await recordBindingEvent(ctx, eventJson, deliveryJson)).receipt);
  }

  @Transaction()
  @Returns("string")
  public async RecordSignedBindingEvent(
    ctx: Context,
    eventJson: string,
    assertionJson: string,
    deliveryJson: string,
  ): Promise<string> {
    return this.stringify(
      (await recordSignedBindingEvent(ctx, eventJson, assertionJson, deliveryJson)).receipt,
    );
  }

  @Transaction(false)
  @Returns("string")
  public async GetRegistrySigningKey(ctx: Context, bindingDigest: string, keyRef: string): Promise<string> {
    const key = await getSigningKey(ctx, requireHash(bindingDigest, "bindingDigest"), requireUuid(keyRef, "keyRef"));
    if (!key) throw contractError("NOT_FOUND", "signing key is not registered");
    return this.stringify(key);
  }

  @Transaction()
  @Returns("string")
  public async ProposeRegistryChange(ctx: Context, requestJson: string): Promise<string> {
    return this.stringify(await proposeChange(ctx, requestJson));
  }

  @Transaction()
  @Returns("string")
  public async ApproveRegistryChange(ctx: Context, proposalId: string): Promise<string> {
    return this.stringify(await approveChange(ctx, proposalId));
  }

  @Transaction()
  @Returns("string")
  public async ExecuteRegistryChange(ctx: Context, proposalId: string): Promise<string> {
    return this.stringify(await executeChange(ctx, proposalId));
  }

  @Transaction(false)
  @Returns("string")
  public async GetBindingProof(ctx: Context, chainRef: string, eventId: string): Promise<string> {
    return this.stringify(await readBindingProof(ctx, chainRef, eventId));
  }

  @Transaction(false)
  @Returns("string")
  public async QueryBindingEvent(ctx: Context, chainRef: string, eventId: string): Promise<string> {
    return this.stringify(await readBindingEvent(ctx, chainRef, eventId));
  }

  @Transaction(false)
  @Returns("string")
  public async GetBindingHead(
    ctx: Context,
    chainRef: string,
    entityType: string,
    entityId: string,
  ): Promise<string> {
    return this.stringify(
      await readBindingHead(ctx, chainRef, requireEntityType(entityType), entityId),
    );
  }

  @Transaction(false)
  @Returns("string")
  public async QueryBindingHistoryPage(
    ctx: Context,
    chainRef: string,
    entityType: string,
    entityId: string,
    pageSize: string,
    bookmark: string,
  ): Promise<string> {
    const size = Number(pageSize);
    if (!Number.isInteger(size) || size < 1 || size > 500)
      throw contractError("INVALID_INPUT", "pageSize must be an integer between 1 and 500");
    return this.stringify(
      await readBindingHistoryPage(ctx, chainRef, requireEntityType(entityType), entityId, size, bookmark),
    );
  }

  @Transaction(false)
  @Returns("string")
  public async GetRegistryBinding(ctx: Context, bindingDigest: string): Promise<string> {
    const found = await getBinding(ctx, requireHash(bindingDigest, "bindingDigest"));
    if (!found) throw contractError("NOT_FOUND", "binding is not registered");
    return this.stringify(found);
  }

  @Transaction(false)
  @Returns("string")
  public async GetRegistryPermission(ctx: Context, permissionRef: string): Promise<string> {
    const found = await getPermission(ctx, requireUuid(permissionRef, "permissionRef"));
    if (!found) throw contractError("NOT_FOUND", "permission is not registered");
    return this.stringify(found);
  }

  @Transaction(false)
  @Returns("string")
  public async GetRegistryCredential(
    ctx: Context,
    bindingDigest: string,
    authority: string,
    certFingerprint: string,
  ): Promise<string> {
    const found = await getCredential(
      ctx,
      requireHash(bindingDigest, "bindingDigest"),
      requireName(authority, "authority"),
      requireHash(certFingerprint, "certFingerprint"),
    );
    if (!found) throw contractError("NOT_FOUND", "credential is not registered");
    return this.stringify(found);
  }

  @Transaction(false)
  @Returns("string")
  public async GetRegistryProposal(ctx: Context, proposalId: string): Promise<string> {
    const found = await getProposal(ctx, requireHash(proposalId, "proposalId"));
    if (!found) throw contractError("NOT_FOUND", "proposal does not exist");
    return this.stringify(found);
  }

  @Transaction(false)
  @Returns("string")
  public async GetDeliveryFence(ctx: Context, chainRef: string, eventId: string): Promise<string> {
    return this.stringify(
      (await getFence(ctx, requireUuid(chainRef, "chainRef"), requireUuid(eventId, "eventId"))) ?? {
        generation: "0",
      },
    );
  }

  @Transaction(false)
  @Returns("string")
  public async QueryEvent(ctx: Context, eventId: string): Promise<string> {
    const key = ctx.stub.createCompositeKey(KEY_TYPES.event, [
      requireEventId(eventId),
    ]);
    return this.stringify(
      fromLedgerBytes<StoredTraceEvent>(
        await ctx.stub.getState(key),
        `event ${eventId}`,
      ),
    );
  }

  @Transaction(false)
  @Returns("string")
  public async GetProof(ctx: Context, eventId: string): Promise<string> {
    const key = ctx.stub.createCompositeKey(KEY_TYPES.proof, [
      requireEventId(eventId),
    ]);
    return this.stringify(
      fromLedgerBytes<BlockchainProof>(
        await ctx.stub.getState(key),
        `proof ${eventId}`,
      ),
    );
  }

  @Transaction(false)
  @Returns("string")
  public async GetExpectedHash(ctx: Context, eventId: string): Promise<string> {
    return (JSON.parse(await this.GetProof(ctx, eventId)) as BlockchainProof)
      .dataHash;
  }

  @Transaction(false)
  @Returns("string")
  public async GetEntityHead(
    ctx: Context,
    entityType: string,
    entityId: string,
  ): Promise<string> {
    const safeType = requireEntityType(entityType);
    const safeId = requireEntityId(entityId);
    const key = ctx.stub.createCompositeKey(KEY_TYPES.entityHead, [
      safeType,
      safeId,
    ]);
    return this.stringify(
      fromLedgerBytes<EntityLedgerHead>(
        await ctx.stub.getState(key),
        `entity ${safeType}/${safeId}`,
      ),
    );
  }

  @Transaction(false)
  @Returns("string")
  public async QueryEntityHistory(
    ctx: Context,
    entityType: string,
    entityId: string,
  ): Promise<string> {
    const safeType = requireEntityType(entityType);
    const safeId = requireEntityId(entityId);
    const iterator = await ctx.stub.getStateByPartialCompositeKey(
      KEY_TYPES.entityEvent,
      [safeType, safeId],
    );
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
    if (events.length === 0)
      throw contractError(
        "NOT_FOUND",
        `entity history ${safeType}/${safeId} does not exist`,
      );
    return this.stringify(events);
  }

  @Transaction(false)
  @Returns("string")
  public async QueryEntityHistoryPage(
    ctx: Context,
    entityType: string,
    entityId: string,
    pageSize: string,
    bookmark: string,
  ): Promise<string> {
    const safeType = requireEntityType(entityType);
    const safeId = requireEntityId(entityId);
    const requestedSize = Number(pageSize);
    if (
      !Number.isInteger(requestedSize) ||
      requestedSize < 1 ||
      requestedSize > 500
    ) {
      throw contractError(
        "INVALID_INPUT",
        "pageSize must be an integer between 1 and 500",
      );
    }
    const result = await ctx.stub.getStateByPartialCompositeKeyWithPagination(
      KEY_TYPES.entityEvent,
      [safeType, safeId],
      requestedSize,
      bookmark,
    );
    const events: StoredTraceEvent[] = [];
    try {
      while (true) {
        const item = await result.iterator.next();
        if (item.value?.value)
          events.push(await this.readHistoryValue(ctx, item.value.value));
        if (item.done) break;
      }
    } finally {
      await result.iterator.close();
    }
    return this.stringify({
      records: events,
      bookmark: result.metadata.bookmark,
      fetchedRecordsCount: result.metadata.fetchedRecordsCount,
    });
  }

  @Transaction(false)
  @Returns("string")
  public async HealthCheck(ctx: Context): Promise<string> {
    const result: HealthResult = {
      status: "OK",
      contract: "AgriTraceContract",
      schemaVersion: SCHEMA_VERSION,
      envelopeVersion: ENVELOPE_VERSION,
      supportedReadVersions: ["2.0.0", "3.0.0"],
      supportedWriteVersions: ["3.0.0", "4.0.0", "6.0.0"],
      signingProtocol: SIGNING_PROTOCOL,
      registryProtocol: "agritrace-governance/1",
      governanceDigest: GOVERNANCE_DIGEST,
      channelPolicy: await getChannelPolicy(ctx),
      callerRole: callerRole(ctx),
    };
    return this.stringify(result);
  }

  @Transaction()
  @Returns('string')
  public async RecordConnectionProbe(ctx:Context,bindingDigest:string,challenge:string,organizationRef:string):Promise<string> {
    return this.stringify(await recordConnectionProbe(ctx,bindingDigest,challenge,organizationRef));
  }

  @Transaction(false)
  @Returns('string')
  public async GetConnectionProbe(ctx:Context,bindingDigest:string,challenge:string):Promise<string> {
    return this.stringify(await readConnectionProbe(ctx,bindingDigest,challenge));
  }

  private assertTechnicalRelayer(ctx: Context): void {
    if (!ctx.clientIdentity.assertAttributeValue("app.role", "relayer")) {
      throw contractError(
        "UNAUTHORIZED_RELAYER",
        "Fabric identity must have app.role=relayer",
      );
    }
  }

  private async readHistoryValue(
    ctx: Context,
    value: Uint8Array,
  ): Promise<StoredTraceEvent> {
    const raw = Buffer.from(value).toString("utf8");
    try {
      const parsed = JSON.parse(raw) as StoredTraceEvent;
      if (parsed.docType === "traceEvent") return parsed;
    } catch {
      // Legacy history entries stored only eventId and are resolved below.
    }
    const eventKey = ctx.stub.createCompositeKey(KEY_TYPES.event, [raw]);
    return fromLedgerBytes<StoredTraceEvent>(
      await ctx.stub.getState(eventKey),
      `event ${raw}`,
    );
  }

  private stringify(value: unknown): string {
    return toLedgerBytes(value).toString("utf8");
  }
}
