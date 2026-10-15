import type { Context } from "fabric-contract-api";

import {
  bindingEventCommitment,
  canonicalNonNegativeInt,
  parseBindingEvent,
  parseStrictJson,
  requireExactKeys,
  requireHash,
  requireUuid,
  type BindingEventInput,
} from "./binding";
import { contractError } from "./errors";
import {
  assertionDigest,
  intentSignedMessage,
  parseSignatureAssertion,
  parseSignedBindingEvent,
  SIGNATURE_REQUIRED_EVENT_TYPES,
  signedBindingEventCommitment,
  signedPrivateBodyDigest,
  verifyEd25519,
  type EventSignature,
} from "./signing";
import { fromLedgerBytes, timestampToIso, toLedgerBytes } from "./ledger";
import {
  callerCertFingerprint,
  compositeKey,
  getBinding,
  getChannelPolicy,
  getCredential,
  getFence,
  getPermission,
  getSigningKey,
  readKey,
  REGISTRY_KEYS,
  requireCallerRole,
} from "./registry";

export interface StoredSignature extends EventSignature {
  algorithm: "Ed25519";
  signature: string;
  orgRef: string;
}

export interface StoredBindingEvent extends BindingEventInput {
  docType: "bindingEvent";
  signature?: StoredSignature;
  txId: string;
  channelId: string;
  recordedAt: string;
  submitterMspId: string;
  submitterId: string;
}

export interface BindingProof {
  docType: "bindingProof";
  signature?: EventSignature & { orgRef: string };
  eventId: string;
  chainRef: string;
  bindingDigest: string;
  entityType: string;
  entityId: string;
  eventType: string;
  eventTime: string;
  dataHash: string;
  previousEventHash: string | null;
  privateBodyDigest: string;
  permissions: BindingEventInput["permissions"];
  txId: string;
  channelId: string;
  recordedAt: string;
  submitterMspId: string;
  submitterId: string;
}

export interface BindingHead {
  docType: "bindingHead";
  chainRef: string;
  entityType: string;
  entityId: string;
  eventCount: number;
  firstEventId: string;
  lastEventId: string;
  lastEventTime: string;
  lastDataHash: string;
  updatedAt: string;
}

const TUPLE_FIELDS = [
  "eventId",
  "entityType",
  "entityId",
  "cycleId",
  "lotId",
  "eventType",
  "eventTime",
  "previousEventHash",
  "privateBodyDigest",
  "bindingDigest",
  "chainRef",
  "dataHash",
] as const;

function parseDelivery(json: string): { generation: string } {
  const input = parseStrictJson(json, "DeliveryContext");
  requireExactKeys(input, ["generation"], "DeliveryContext");
  return { generation: canonicalNonNegativeInt(input.generation, "generation") };
}

/** Verified ledger write for release B. Every decision reads registry keys
 * (so they enter the read set): a registry change validated before this
 * transaction invalidates it through MVCC; nothing depends on wall clocks,
 * caches or the endorser's own view outside the ledger. */
export async function recordBindingEvent(
  ctx: Context,
  eventJson: string,
  deliveryJson: string,
): Promise<{ receipt: Record<string, unknown> }> {
  requireCallerRole(ctx, "relayer");
  const input = parseBindingEvent(eventJson);
  const delivery = parseDelivery(deliveryJson);
  if (SIGNATURE_REQUIRED_EVENT_TYPES.includes(input.eventType))
    throw contractError("SIGNATURE_REQUIRED", `${input.eventType} must carry an organization signature`);

  // The commitment binds every public field (and the private body digest)
  // to dataHash; a relayer cannot substitute context around a valid hash.
  if (bindingEventCommitment(input) !== input.dataHash)
    throw contractError("INVALID_INPUT", "dataHash is not the commitment of the public event body");
  return commitVerifiedEvent(ctx, input, delivery, undefined);
}

/** Release C write: the event commits to an independent organization
 * signature over a private intent. The ledger verifies the signature against
 * the registered key and the event's public identity, then stores the same
 * proof/head/history as release B plus the signature reference. */
export async function recordSignedBindingEvent(
  ctx: Context,
  eventJson: string,
  assertionJson: string,
  deliveryJson: string,
): Promise<{ receipt: Record<string, unknown> }> {
  requireCallerRole(ctx, "relayer");
  const input = parseSignedBindingEvent(eventJson);
  const assertion = parseSignatureAssertion(assertionJson);
  const delivery = parseDelivery(deliveryJson);

  if (signedPrivateBodyDigest(input.signature) !== input.privateBodyDigest)
    throw contractError("INVALID_INPUT", "privateBodyDigest differs from signed content commitments");
  if (signedBindingEventCommitment(input) !== input.dataHash)
    throw contractError("INVALID_INPUT", "dataHash is not the commitment of the signed public event body");
  if (
    assertion.keyRef !== input.signature.keyRef ||
    assertion.intentDigest !== input.signature.intentDigest ||
    assertion.payloadDigest !== input.signature.payloadDigest ||
    assertionDigest(assertion) !== input.signature.assertionDigest
  )
    throw contractError("SIGNATURE_INVALID", "assertion differs from the signature committed by dataHash");

  const binding = await getBinding(ctx, input.bindingDigest);
  if (!binding) throw contractError("BINDING_UNKNOWN", "binding is not registered");
  const key = await getSigningKey(ctx, input.bindingDigest, assertion.keyRef);
  if (!key) throw contractError("SIGNING_KEY_INACTIVE", "signing key is not registered for this binding");
  if (key.status !== "ACTIVE")
    throw contractError("SIGNING_KEY_INACTIVE", "signing key was revoked");
  const message = intentSignedMessage({
    intentDigest: assertion.intentDigest,
    chainRef: input.chainRef,
    eventId: input.eventId,
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: input.eventType,
    bindingDigest: input.bindingDigest,
    keyRef: assertion.keyRef,
    payloadDigest: assertion.payloadDigest,
  });
  if (!verifyEd25519(key.publicKey, message, assertion.signature))
    throw contractError("SIGNATURE_INVALID", "signature does not verify for this event");
  return commitVerifiedEvent(ctx, input, delivery, {
    ...input.signature,
    algorithm: "Ed25519",
    signature: assertion.signature,
    orgRef: key.orgRef,
  });
}

async function commitVerifiedEvent(
  ctx: Context,
  input: BindingEventInput,
  delivery: { generation: string },
  signature: StoredSignature | undefined,
): Promise<{ receipt: Record<string, unknown> }> {

  const policy = await getChannelPolicy(ctx);
  if (!policy?.strictB)
    throw contractError("CHANNEL_NOT_BOOTSTRAPPED", "channel has no strict-B bootstrap policy");
  const binding = await getBinding(ctx, input.bindingDigest);
  if (!binding) throw contractError("BINDING_UNKNOWN", "binding is not registered");
  const channelId = ctx.stub.getChannelID();
  if (
    binding.channelId !== channelId ||
    binding.chainRef !== input.chainRef ||
    binding.status !== "ACTIVE"
  )
    throw contractError("BINDING_MISMATCH", "event does not belong to this binding/channel/chain");

  // Writer authority comes from trusted-CA attributes, never from the payload.
  const submitterMspId = ctx.clientIdentity.getMSPID();
  const authority = ctx.clientIdentity.getAttributeValue("app.authority");
  if (submitterMspId !== binding.writerMspId || authority !== binding.writerAuthority)
    throw contractError("UNAUTHORIZED_RELAYER", "relayer MSP/authority differs from the binding writer");
  const credential = await getCredential(
    ctx,
    binding.bindingDigest,
    binding.writerAuthority,
    callerCertFingerprint(ctx),
  );
  if (credential?.status !== "ACTIVE")
    throw contractError("UNAUTHORIZED_RELAYER", "relayer certificate is not an approved credential");

  for (const item of input.permissions) {
    const permission = await getPermission(ctx, item.permissionRef);
    if (
      !permission ||
      permission.bindingDigest !== binding.bindingDigest ||
      permission.status !== "ACTIVE" ||
      permission.epoch !== item.epoch
    )
      throw contractError("PERMISSION_INACTIVE", `permission ${item.permissionRef} is not active at epoch ${item.epoch}`);
    if (!permission.entityTypes.includes(input.entityType))
      throw contractError("PERMISSION_INACTIVE", `permission ${item.permissionRef} does not cover ${input.entityType}`);
  }

  const fence = await getFence(ctx, input.chainRef, input.eventId);
  const generation = fence?.generation ?? "0";
  if (delivery.generation !== generation)
    throw contractError("DELIVERY_FENCED", `delivery generation ${delivery.generation} is stale; current is ${generation}`);
  if (fence && fence.dataHash !== input.dataHash)
    throw contractError("DELIVERY_FENCED", "delivery fence pins a different event commitment");

  const eventKey = compositeKey(ctx, REGISTRY_KEYS.event, [input.chainRef, input.eventId]);
  const previousBytes = await ctx.stub.getState(eventKey);
  if (previousBytes.length > 0) {
    const previous = fromLedgerBytes<StoredBindingEvent>(previousBytes, "event");
    if (
      TUPLE_FIELDS.some((field) => (previous[field] ?? null) !== (input[field] ?? null)) ||
      (previous.signature?.assertionDigest ?? null) !== (signature?.assertionDigest ?? null)
    )
      throw contractError("DUPLICATE_EVENT_CONFLICT", "eventId already exists with a different public tuple");
    throw contractError("DUPLICATE_EVENT", `eventId ${input.eventId} already exists`);
  }

  const headKey = compositeKey(ctx, REGISTRY_KEYS.head, [input.chainRef, input.entityType, input.entityId]);
  const head = await readKey<BindingHead>(ctx, headKey);
  if (head && input.previousEventHash !== head.lastDataHash)
    throw contractError("HASH_CHAIN_CONFLICT", "previousEventHash does not match the current entity head");
  if (!head && input.previousEventHash)
    throw contractError("HASH_CHAIN_CONFLICT", "genesis event must not declare previousEventHash");

  const txId = ctx.stub.getTxID();
  const recordedAt = timestampToIso(ctx.stub.getTxTimestamp());
  const submitterId = ctx.clientIdentity.getID();
  if (signature) {
    // An intent authorizes exactly one event. The key makes concurrent reuse
    // conflict at validation instead of relying on the relayer's behaviour.
    const intentKey = compositeKey(ctx, REGISTRY_KEYS.intent, [input.chainRef, signature.intentDigest]);
    if ((await ctx.stub.getState(intentKey)).length > 0)
      throw contractError("SIGNATURE_REPLAY", "this signed intent was already used");
    await ctx.stub.putState(intentKey, toLedgerBytes({ docType: "signedIntent", eventId: input.eventId }));
  }
  const event: StoredBindingEvent = {
    docType: "bindingEvent",
    ...input,
    ...(signature ? { signature } : {}),
    txId,
    channelId,
    recordedAt,
    submitterMspId,
    submitterId,
  };
  const proof: BindingProof = {
    docType: "bindingProof",
    eventId: input.eventId,
    chainRef: input.chainRef,
    bindingDigest: input.bindingDigest,
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: input.eventType,
    eventTime: input.eventTime,
    dataHash: input.dataHash,
    previousEventHash: input.previousEventHash,
    privateBodyDigest: input.privateBodyDigest,
    permissions: input.permissions,
    ...(signature
      ? {
          signature: {
            keyRef: signature.keyRef,
            intentDigest: signature.intentDigest,
            assertionDigest: signature.assertionDigest,
            payloadDigest: signature.payloadDigest,
            metadataDigest: signature.metadataDigest,
            orgRef: signature.orgRef,
          },
        }
      : {}),
    txId,
    channelId,
    recordedAt,
    submitterMspId,
    submitterId,
  };
  const nextHead: BindingHead = {
    docType: "bindingHead",
    chainRef: input.chainRef,
    entityType: input.entityType,
    entityId: input.entityId,
    eventCount: (head?.eventCount ?? 0) + 1,
    firstEventId: head?.firstEventId ?? input.eventId,
    lastEventId: input.eventId,
    lastEventTime: input.eventTime,
    lastDataHash: input.dataHash,
    updatedAt: recordedAt,
  };
  await ctx.stub.putState(eventKey, toLedgerBytes(event));
  await ctx.stub.putState(
    compositeKey(ctx, REGISTRY_KEYS.proof, [input.chainRef, input.eventId]),
    toLedgerBytes(proof),
  );
  await ctx.stub.putState(headKey, toLedgerBytes(nextHead));
  await ctx.stub.putState(
    compositeKey(ctx, REGISTRY_KEYS.history, [
      input.chainRef,
      input.entityType,
      input.entityId,
      recordedAt,
      txId,
      input.eventId,
    ]),
    toLedgerBytes(event),
  );
  await ctx.stub.setEvent("BindingEventRecorded", toLedgerBytes(proof));
  return {
    receipt: {
      status: "SUBMITTED",
      eventId: input.eventId,
      chainRef: input.chainRef,
      dataHash: input.dataHash,
      txId,
      recordedAt,
      submitterMspId,
    },
  };
}

export async function readBindingProof(
  ctx: Context,
  chainRef: string,
  eventId: string,
): Promise<BindingProof> {
  const bytes = await ctx.stub.getState(
    compositeKey(ctx, REGISTRY_KEYS.proof, [requireUuid(chainRef, "chainRef"), requireUuid(eventId, "eventId")]),
  );
  return fromLedgerBytes<BindingProof>(bytes, `binding proof ${eventId}`);
}

export async function readBindingEvent(
  ctx: Context,
  chainRef: string,
  eventId: string,
): Promise<StoredBindingEvent> {
  const bytes = await ctx.stub.getState(
    compositeKey(ctx, REGISTRY_KEYS.event, [requireUuid(chainRef, "chainRef"), requireUuid(eventId, "eventId")]),
  );
  return fromLedgerBytes<StoredBindingEvent>(bytes, `binding event ${eventId}`);
}

export async function readBindingHead(
  ctx: Context,
  chainRef: string,
  entityType: string,
  entityId: string,
): Promise<BindingHead> {
  const bytes = await ctx.stub.getState(
    compositeKey(ctx, REGISTRY_KEYS.head, [
      requireUuid(chainRef, "chainRef"),
      entityType,
      requireUuid(entityId, "entityId"),
    ]),
  );
  return fromLedgerBytes<BindingHead>(bytes, `binding head ${entityType}/${entityId}`);
}

export async function readBindingHistoryPage(
  ctx: Context,
  chainRef: string,
  entityType: string,
  entityId: string,
  pageSize: number,
  bookmark: string,
) {
  const result = await ctx.stub.getStateByPartialCompositeKeyWithPagination(
    REGISTRY_KEYS.history,
    [requireUuid(chainRef, "chainRef"), entityType, requireUuid(entityId, "entityId")],
    pageSize,
    bookmark,
  );
  const records: StoredBindingEvent[] = [];
  try {
    while (true) {
      const item = await result.iterator.next();
      if (item.value?.value)
        records.push(
          JSON.parse(Buffer.from(item.value.value).toString("utf8")) as StoredBindingEvent,
        );
      if (item.done) break;
    }
  } finally {
    await result.iterator.close();
  }
  return {
    records,
    bookmark: result.metadata.bookmark,
    fetchedRecordsCount: result.metadata.fetchedRecordsCount,
  };
}

export { requireHash };
