import type { Context } from "fabric-contract-api";
import { canonicalize } from "json-canonicalize";

import {
  B_ENVELOPE_VERSION,
  bindingDigest,
  canonicalNonNegativeInt,
  canonicalPositiveInt,
  parseBindingTuple,
  parseStrictJson,
  requireExactKeys,
  requireHash,
  requireName,
  requireUuid,
  sha256,
  type BindingTuple,
} from "./binding";
import { contractError } from "./errors";
import {
  approvalSatisfied,
  channelGovernance,
  GOVERNANCE_DIGEST,
  REGISTRY_KINDS,
  type RegistryKind,
} from "./governance";
import { fromLedgerBytes, timestampToIso, toLedgerBytes } from "./ledger";
import { parseKeyRegistration } from "./signing";
import { ENTITY_TYPES } from "./types";

export const REGISTRY_KEYS = {
  channelPolicy: "b1.channelPolicy",
  binding: "b1.binding",
  permission: "b1.permission",
  credential: "b1.writerCredential",
  fence: "b1.deliveryFence",
  proposal: "b1.proposal",
  approval: "b1.approval",
  event: "b1.event",
  proof: "b1.proof",
  head: "b1.head",
  history: "b1.history",
  signingKey: "c1.signingKey",
  intent: "c1.intent",
} as const;

export interface ChannelPolicy {
  docType: "channelPolicy";
  channelId: string;
  strictB: true;
  allowLegacyV3Writes: boolean;
  governanceDigest: string;
  revision: number;
}
export interface RegisteredBinding extends BindingTuple {
  docType: "binding";
  bindingDigest: string;
  status: "ACTIVE";
  revision: number;
}
export interface RegisteredPermission {
  docType: "permission";
  permissionRef: string;
  bindingDigest: string;
  epoch: string;
  status: "ACTIVE" | "REVOKED";
  entityTypes: string[];
  reviewRequired: boolean;
  revision: number;
}
export interface RegisteredCredential {
  docType: "writerCredential";
  bindingDigest: string;
  authority: string;
  certFingerprint: string;
  status: "ACTIVE" | "REVOKED";
  revision: number;
}
export interface RegisteredSigningKey {
  docType: "signingKey";
  bindingDigest: string;
  keyRef: string;
  orgRef: string;
  algorithm: "Ed25519";
  publicKey: string;
  status: "ACTIVE" | "REVOKED";
  revision: number;
}
export interface DeliveryFence {
  docType: "deliveryFence";
  chainRef: string;
  eventId: string;
  generation: string;
  dataHash: string;
  revision: number;
}
export interface Proposal {
  docType: "registryProposal";
  proposalId: string;
  kind: RegistryKind;
  payload: Record<string, unknown>;
  expectedRevision: string;
  nonce: string;
  proposerMsp: string;
  proposedAt: string;
  status: "OPEN" | "EXECUTED";
  result?: Record<string, unknown>;
  executedAt?: string;
  executedTxId?: string;
}

const REQUEST_KEYS = ["kind", "payload", "expectedRevision", "nonce"] as const;

export function callerRole(ctx: Context): string | null {
  return ctx.clientIdentity.getAttributeValue("app.role");
}

/** SHA-256 of the DER certificate of the invoking identity. */
export function callerCertFingerprint(ctx: Context): string {
  const pem = Buffer.from(ctx.clientIdentity.getIDBytes()).toString("utf8");
  const body = pem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
  if (!body) throw contractError("UNAUTHORIZED_RELAYER", "caller certificate is unavailable");
  return sha256(Buffer.from(body, "base64"));
}

export function requireCallerRole(ctx: Context, role: "controller" | "admin" | "relayer"): void {
  if (callerRole(ctx) !== role)
    throw contractError(
      role === "relayer" ? "UNAUTHORIZED_RELAYER" : "UNAUTHORIZED_CONTROL",
      `Fabric identity must have app.role=${role}`,
    );
}

export async function readKey<T>(ctx: Context, key: string): Promise<T | undefined> {
  const bytes = await ctx.stub.getState(key);
  return bytes.length === 0 ? undefined : fromLedgerBytes<T>(bytes, key);
}

export function compositeKey(ctx: Context, type: string, attributes: string[]): string {
  return ctx.stub.createCompositeKey(type, attributes);
}

export async function getChannelPolicy(ctx: Context): Promise<ChannelPolicy | undefined> {
  return readKey<ChannelPolicy>(ctx, REGISTRY_KEYS.channelPolicy);
}

export async function getBinding(ctx: Context, digest: string): Promise<RegisteredBinding | undefined> {
  return readKey<RegisteredBinding>(ctx, compositeKey(ctx, REGISTRY_KEYS.binding, [digest]));
}

export async function getPermission(ctx: Context, ref: string): Promise<RegisteredPermission | undefined> {
  return readKey<RegisteredPermission>(ctx, compositeKey(ctx, REGISTRY_KEYS.permission, [ref]));
}

export async function getCredential(
  ctx: Context,
  digest: string,
  authority: string,
  fingerprint: string,
): Promise<RegisteredCredential | undefined> {
  return readKey<RegisteredCredential>(
    ctx,
    compositeKey(ctx, REGISTRY_KEYS.credential, [digest, authority, fingerprint]),
  );
}

export async function getSigningKey(
  ctx: Context,
  digest: string,
  keyRef: string,
): Promise<RegisteredSigningKey | undefined> {
  return readKey<RegisteredSigningKey>(ctx, compositeKey(ctx, REGISTRY_KEYS.signingKey, [digest, keyRef]));
}

export async function getFence(ctx: Context, chainRef: string, eventId: string): Promise<DeliveryFence | undefined> {
  return readKey<DeliveryFence>(ctx, compositeKey(ctx, REGISTRY_KEYS.fence, [chainRef, eventId]));
}

export async function getProposal(ctx: Context, id: string): Promise<Proposal | undefined> {
  return readKey<Proposal>(ctx, compositeKey(ctx, REGISTRY_KEYS.proposal, [id]));
}

function parseRequest(json: string) {
  const input = parseStrictJson(json, "RegistryChange");
  requireExactKeys(input, REQUEST_KEYS, "RegistryChange");
  if (typeof input.kind !== "string" || !(REGISTRY_KINDS as readonly string[]).includes(input.kind))
    throw contractError("INVALID_INPUT", "unsupported registry change kind");
  if (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload))
    throw contractError("INVALID_INPUT", "payload must be an object");
  return {
    kind: input.kind as RegistryKind,
    payload: input.payload as Record<string, unknown>,
    expectedRevision: canonicalNonNegativeInt(input.expectedRevision, "expectedRevision"),
    nonce: requireUuid(input.nonce, "nonce"),
  };
}

export function proposalIdOf(request: {
  kind: string;
  payload: unknown;
  expectedRevision: string;
  nonce: string;
}): string {
  return sha256(
    canonicalize({
      protocol: "agritrace-registry-change/1",
      kind: request.kind,
      payload: request.payload,
      expectedRevision: request.expectedRevision,
      nonce: request.nonce,
    }),
  );
}

export async function proposeChange(ctx: Context, requestJson: string): Promise<Proposal> {
  requireCallerRole(ctx, "controller");
  const channelId = ctx.stub.getChannelID();
  const governance = channelGovernance(channelId);
  const request = parseRequest(requestJson);
  // Reject malformed payloads at proposal time: approvers sign an exact,
  // already-validated change, not an arbitrary blob.
  await validatePayload(ctx, request.kind, request.payload, request.expectedRevision, true);
  const proposalId = proposalIdOf(request);
  const key = compositeKey(ctx, REGISTRY_KEYS.proposal, [proposalId]);
  const existing = await readKey<Proposal>(ctx, key);
  if (existing) return existing;
  const proposerMsp = ctx.clientIdentity.getMSPID();
  if (proposerMsp !== governance.writerMsp)
    throw contractError("UNAUTHORIZED_CONTROL", "only the writer MSP control plane may propose changes");
  const proposal: Proposal = {
    docType: "registryProposal",
    proposalId,
    kind: request.kind,
    payload: request.payload,
    expectedRevision: request.expectedRevision,
    nonce: request.nonce,
    proposerMsp,
    proposedAt: timestampToIso(ctx.stub.getTxTimestamp()),
    status: "OPEN",
  };
  await ctx.stub.putState(key, toLedgerBytes(proposal));
  return proposal;
}

export async function approveChange(
  ctx: Context,
  proposalId: string,
): Promise<{ proposalId: string; msp: string }> {
  requireCallerRole(ctx, "admin");
  requireHash(proposalId, "proposalId");
  const proposal = await getProposal(ctx, proposalId);
  if (!proposal) throw contractError("NOT_FOUND", "proposal does not exist");
  if (proposal.status !== "OPEN")
    throw contractError("PROPOSAL_NOT_OPEN", "proposal is already executed");
  const governance = channelGovernance(ctx.stub.getChannelID());
  const msp = ctx.clientIdentity.getMSPID();
  if (!governance.approvals[proposal.kind].msps.includes(msp))
    throw contractError("UNAUTHORIZED_CONTROL", `MSP ${msp} cannot approve ${proposal.kind}`);
  const key = compositeKey(ctx, REGISTRY_KEYS.approval, [proposalId, msp]);
  if (!(await readKey(ctx, key)))
    await ctx.stub.putState(
      key,
      toLedgerBytes({
        docType: "registryApproval",
        proposalId,
        msp,
        approverId: ctx.clientIdentity.getID(),
        approvedAt: timestampToIso(ctx.stub.getTxTimestamp()),
      }),
    );
  return { proposalId, msp };
}

async function approvedMsps(ctx: Context, proposal: Proposal): Promise<Set<string>> {
  const governance = channelGovernance(ctx.stub.getChannelID());
  const approved = new Set<string>();
  for (const msp of governance.approvals[proposal.kind].msps)
    if (await readKey(ctx, compositeKey(ctx, REGISTRY_KEYS.approval, [proposal.proposalId, msp])))
      approved.add(msp);
  return approved;
}

export async function executeChange(ctx: Context, proposalId: string): Promise<Proposal> {
  requireCallerRole(ctx, "controller");
  requireHash(proposalId, "proposalId");
  const proposal = await getProposal(ctx, proposalId);
  if (!proposal) throw contractError("NOT_FOUND", "proposal does not exist");
  if (proposal.status !== "OPEN")
    throw contractError("PROPOSAL_NOT_OPEN", "proposal was already executed");
  const governance = channelGovernance(ctx.stub.getChannelID());
  const approved = await approvedMsps(ctx, proposal);
  if (!approvalSatisfied(governance.approvals[proposal.kind], approved))
    throw contractError("APPROVALS_MISSING", `${proposal.kind} lacks the required admin approvals`);
  const result = await applyChange(ctx, proposal);
  const executed: Proposal = {
    ...proposal,
    status: "EXECUTED",
    result,
    executedAt: timestampToIso(ctx.stub.getTxTimestamp()),
    executedTxId: ctx.stub.getTxID(),
  };
  await ctx.stub.putState(
    compositeKey(ctx, REGISTRY_KEYS.proposal, [proposalId]),
    toLedgerBytes(executed),
  );
  return executed;
}

function requireEntityTypes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > ENTITY_TYPES.length)
    throw contractError("INVALID_INPUT", "entityTypes must list 1-10 entity types");
  const sorted = [...value];
  for (const item of sorted)
    if (typeof item !== "string" || !(ENTITY_TYPES as readonly string[]).includes(item))
      throw contractError("INVALID_INPUT", "entityTypes contains an unsupported entity type");
  const unique = [...new Set(sorted as string[])].sort();
  if (unique.length !== sorted.length || unique.join() !== (sorted as string[]).join())
    throw contractError("INVALID_INPUT", "entityTypes must be sorted and unique");
  return unique;
}

/** Validates the payload and, when `forProposal` is false, the live state it
 * would change. Revisions are checked again at execution so a stale approval
 * can never apply over a newer registry state (MVCC protects the race). */
async function validatePayload(
  ctx: Context,
  kind: RegistryKind,
  payload: Record<string, unknown>,
  expectedRevision: string,
  forProposal: boolean,
): Promise<Record<string, unknown>> {
  const channelId = ctx.stub.getChannelID();
  switch (kind) {
    case "CHANNEL_BOOTSTRAP": {
      requireExactKeys(payload, ["channelId", "strictB", "allowLegacyV3Writes"], kind);
      if (payload.channelId !== channelId)
        throw contractError("INVALID_INPUT", "channelId differs from the invoking channel");
      // The release-A writer is gone; the flag stays in the stored policy
      // format and must be false so no channel can claim legacy writes.
      if (payload.strictB !== true || payload.allowLegacyV3Writes !== false)
        throw contractError("INVALID_INPUT", "bootstrap requires strictB=true and allowLegacyV3Writes=false");
      if (expectedRevision !== "0")
        throw contractError("INVALID_INPUT", "channel bootstrap is a one-time change");
      if (!forProposal && (await getChannelPolicy(ctx)))
        throw contractError("REVISION_CONFLICT", "channel is already bootstrapped");
      return payload;
    }
    case "BINDING_REGISTER": {
      requireExactKeys(payload, ["binding", "bindingDigest"], kind);
      const tuple = parseBindingTuple(payload.binding);
      const digest = requireHash(payload.bindingDigest, "bindingDigest");
      const governance = channelGovernance(channelId);
      if (bindingDigest(tuple) !== digest)
        throw contractError("INVALID_INPUT", "bindingDigest does not match the logical binding");
      if (
        tuple.channelId !== channelId ||
        tuple.contractName !== "AgriTraceContract" ||
        tuple.governanceDigest !== GOVERNANCE_DIGEST ||
        tuple.writerMspId !== governance.writerMsp
      )
        throw contractError("INVALID_INPUT", "binding differs from this channel's reviewed governance");
      if (expectedRevision !== "0")
        throw contractError("INVALID_INPUT", "a binding is immutable once registered");
      if (!forProposal && (await getBinding(ctx, digest)))
        throw contractError("REVISION_CONFLICT", "binding is already registered");
      return payload;
    }
    case "CREDENTIAL_APPROVE":
    case "CREDENTIAL_REVOKE": {
      requireExactKeys(payload, ["bindingDigest", "authority", "certFingerprint"], kind);
      const digest = requireHash(payload.bindingDigest, "bindingDigest");
      requireName(payload.authority, "authority");
      const fingerprint = requireHash(payload.certFingerprint, "certFingerprint");
      if (!forProposal) {
        const binding = await getBinding(ctx, digest);
        if (!binding) throw contractError("NOT_FOUND", "binding is not registered");
        if (binding.writerAuthority !== payload.authority)
          throw contractError("INVALID_INPUT", "credential authority differs from the binding writer");
        const current = await getCredential(ctx, digest, binding.writerAuthority, fingerprint);
        const revision = String(current?.revision ?? 0);
        if (revision !== expectedRevision)
          throw contractError("REVISION_CONFLICT", "credential revision changed");
        if (kind === "CREDENTIAL_APPROVE" && current?.status === "ACTIVE")
          throw contractError("REVISION_CONFLICT", "credential is already active");
        if (kind === "CREDENTIAL_REVOKE" && current?.status !== "ACTIVE")
          throw contractError("REVISION_CONFLICT", "only an active credential can be revoked");
      }
      return payload;
    }
    case "PERMISSION_GRANT": {
      requireExactKeys(payload, ["permissionRef", "bindingDigest", "epoch", "entityTypes"], kind);
      const ref = requireUuid(payload.permissionRef, "permissionRef");
      const digest = requireHash(payload.bindingDigest, "bindingDigest");
      const epoch = canonicalPositiveInt(payload.epoch, "epoch");
      requireEntityTypes(payload.entityTypes);
      if (!forProposal) {
        if (!(await getBinding(ctx, digest)))
          throw contractError("NOT_FOUND", "binding is not registered");
        const current = await getPermission(ctx, ref);
        if (String(current?.revision ?? 0) !== expectedRevision)
          throw contractError("REVISION_CONFLICT", "permission revision changed");
        if (current && (current.status !== "REVOKED" || current.bindingDigest !== digest))
          throw contractError("REVISION_CONFLICT", "permission is active or belongs to another binding");
        const next = current ? BigInt(current.epoch) + 1n : 1n;
        if (BigInt(epoch) !== next)
          throw contractError("REVISION_CONFLICT", `permission epoch must be ${next}`);
      }
      return payload;
    }
    case "PERMISSION_REVOKE":
    case "PERMISSION_EMERGENCY_REVOKE": {
      requireExactKeys(payload, ["permissionRef", "epoch"], kind);
      const ref = requireUuid(payload.permissionRef, "permissionRef");
      const epoch = canonicalPositiveInt(payload.epoch, "epoch");
      if (!forProposal) {
        const current = await getPermission(ctx, ref);
        if (!current) throw contractError("NOT_FOUND", "permission is not registered");
        if (String(current.revision) !== expectedRevision)
          throw contractError("REVISION_CONFLICT", "permission revision changed");
        if (current.status !== "ACTIVE" || current.epoch !== epoch)
          throw contractError("REVISION_CONFLICT", "only the current active epoch can be revoked");
      }
      return payload;
    }
    case "SIGNING_KEY_REGISTER": {
      // Proof of possession is checked on proposal so approvers never sign
      // off on a key whose holder has not demonstrated the private key.
      const key = parseKeyRegistration(payload);
      if (expectedRevision !== "0")
        throw contractError("INVALID_INPUT", "a signing key is registered once; use a new keyRef to rotate");
      if (!forProposal) {
        if (!(await getBinding(ctx, key.bindingDigest)))
          throw contractError("NOT_FOUND", "binding is not registered");
        if (await getSigningKey(ctx, key.bindingDigest, key.keyRef))
          throw contractError("REVISION_CONFLICT", "signing key is already registered");
      }
      return payload;
    }
    case "SIGNING_KEY_REVOKE": {
      requireExactKeys(payload, ["bindingDigest", "keyRef"], kind);
      const digest = requireHash(payload.bindingDigest, "bindingDigest");
      const keyRef = requireUuid(payload.keyRef, "keyRef");
      if (!forProposal) {
        const current = await getSigningKey(ctx, digest, keyRef);
        if (!current) throw contractError("NOT_FOUND", "signing key is not registered");
        if (String(current.revision) !== expectedRevision)
          throw contractError("REVISION_CONFLICT", "signing key revision changed");
        if (current.status !== "ACTIVE")
          throw contractError("REVISION_CONFLICT", "only an active signing key can be revoked");
      }
      return payload;
    }
    case "FENCE_DELIVERY": {
      requireExactKeys(payload, ["chainRef", "bindingDigest", "eventId", "dataHash"], kind);
      requireUuid(payload.chainRef, "chainRef");
      requireHash(payload.bindingDigest, "bindingDigest");
      requireUuid(payload.eventId, "eventId");
      requireHash(payload.dataHash, "dataHash");
      return payload;
    }
  }
}

async function applyChange(ctx: Context, proposal: Proposal): Promise<Record<string, unknown>> {
  const payload = await validatePayload(
    ctx,
    proposal.kind,
    proposal.payload,
    proposal.expectedRevision,
    false,
  );
  const channelId = ctx.stub.getChannelID();
  const put = (type: string, attributes: string[], value: unknown) =>
    ctx.stub.putState(compositeKey(ctx, type, attributes), toLedgerBytes(value));
  switch (proposal.kind) {
    case "CHANNEL_BOOTSTRAP": {
      const policy: ChannelPolicy = {
        docType: "channelPolicy",
        channelId,
        strictB: true,
        allowLegacyV3Writes: false,
        governanceDigest: GOVERNANCE_DIGEST,
        revision: 1,
      };
      await ctx.stub.putState(REGISTRY_KEYS.channelPolicy, toLedgerBytes(policy));
      return { allowLegacyV3Writes: policy.allowLegacyV3Writes };
    }
    case "BINDING_REGISTER": {
      const tuple = parseBindingTuple(payload.binding);
      const digest = payload.bindingDigest as string;
      const binding: RegisteredBinding = {
        docType: "binding",
        ...tuple,
        bindingDigest: digest,
        status: "ACTIVE",
        revision: 1,
      };
      await put(REGISTRY_KEYS.binding, [digest], binding);
      return { bindingDigest: digest };
    }
    case "CREDENTIAL_APPROVE":
    case "CREDENTIAL_REVOKE": {
      const digest = payload.bindingDigest as string;
      const authority = payload.authority as string;
      const fingerprint = payload.certFingerprint as string;
      const credential: RegisteredCredential = {
        docType: "writerCredential",
        bindingDigest: digest,
        authority,
        certFingerprint: fingerprint,
        status: proposal.kind === "CREDENTIAL_APPROVE" ? "ACTIVE" : "REVOKED",
        revision: Number(proposal.expectedRevision) + 1,
      };
      await put(REGISTRY_KEYS.credential, [digest, authority, fingerprint], credential);
      return { status: credential.status, certFingerprint: fingerprint };
    }
    case "PERMISSION_GRANT": {
      const ref = payload.permissionRef as string;
      const permission: RegisteredPermission = {
        docType: "permission",
        permissionRef: ref,
        bindingDigest: payload.bindingDigest as string,
        epoch: payload.epoch as string,
        status: "ACTIVE",
        entityTypes: payload.entityTypes as string[],
        reviewRequired: false,
        revision: Number(proposal.expectedRevision) + 1,
      };
      await put(REGISTRY_KEYS.permission, [ref], permission);
      return { permissionRef: ref, epoch: permission.epoch, status: "ACTIVE" };
    }
    case "PERMISSION_REVOKE":
    case "PERMISSION_EMERGENCY_REVOKE": {
      const ref = payload.permissionRef as string;
      const current = (await getPermission(ctx, ref))!;
      const revoked: RegisteredPermission = {
        ...current,
        status: "REVOKED",
        reviewRequired: proposal.kind === "PERMISSION_EMERGENCY_REVOKE",
        revision: current.revision + 1,
      };
      await put(REGISTRY_KEYS.permission, [ref], revoked);
      return {
        permissionRef: ref,
        epoch: revoked.epoch,
        status: "REVOKED",
        reviewRequired: revoked.reviewRequired,
      };
    }
    case "SIGNING_KEY_REGISTER": {
      const key = parseKeyRegistration(payload);
      const record: RegisteredSigningKey = {
        docType: "signingKey",
        bindingDigest: key.bindingDigest,
        keyRef: key.keyRef,
        orgRef: key.orgRef,
        algorithm: "Ed25519",
        publicKey: key.publicKey,
        status: "ACTIVE",
        revision: 1,
      };
      await put(REGISTRY_KEYS.signingKey, [key.bindingDigest, key.keyRef], record);
      return { keyRef: key.keyRef, orgRef: key.orgRef, status: "ACTIVE" };
    }
    case "SIGNING_KEY_REVOKE": {
      const digest = payload.bindingDigest as string;
      const keyRef = payload.keyRef as string;
      const current = (await getSigningKey(ctx, digest, keyRef))!;
      const revoked: RegisteredSigningKey = {
        ...current,
        status: "REVOKED",
        revision: current.revision + 1,
      };
      await put(REGISTRY_KEYS.signingKey, [digest, keyRef], revoked);
      return { keyRef, status: "REVOKED" };
    }
    case "FENCE_DELIVERY": {
      const chainRef = payload.chainRef as string;
      const eventId = payload.eventId as string;
      // Same transaction reads the event key: a committed event wins over a
      // fence, and its tuple is returned for reconciliation instead.
      const committed = await ctx.stub.getState(
        compositeKey(ctx, REGISTRY_KEYS.event, [chainRef, eventId]),
      );
      if (committed.length > 0) {
        const event = fromLedgerBytes<{ dataHash: string; txId: string }>(committed, "event");
        return { outcome: "EVENT_COMMITTED", dataHash: event.dataHash, txId: event.txId };
      }
      const current = await getFence(ctx, chainRef, eventId);
      if (String(current?.revision ?? 0) !== proposal.expectedRevision)
        throw contractError("REVISION_CONFLICT", "delivery fence revision changed");
      if (current && current.dataHash !== payload.dataHash)
        throw contractError("REVISION_CONFLICT", "fence pins a different event commitment");
      const next = BigInt(current?.generation ?? "0") + 1n;
      const fence: DeliveryFence = {
        docType: "deliveryFence",
        chainRef,
        eventId,
        generation: next.toString(),
        dataHash: payload.dataHash as string,
        revision: (current?.revision ?? 0) + 1,
      };
      await put(REGISTRY_KEYS.fence, [chainRef, eventId], fence);
      return { outcome: "FENCED", generation: fence.generation };
    }
  }
}

export { B_ENVELOPE_VERSION };
