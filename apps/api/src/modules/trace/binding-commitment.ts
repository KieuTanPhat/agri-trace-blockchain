import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { calculateTraceEventHash, type TraceHashInput } from './trace-hash.js';

/** Release B commitments (hybrid design B0). Release A events keep envelope
 * 3.0.0 / hash 2.0.0 untouched; these versions apply to B streams only. */
export const BINDING_PROTOCOL = 'agritrace-fabric-binding/1';
export const B_ENVELOPE_VERSION = '4.0.0';
export const B_SCHEMA_VERSION = '3.0.0';
export const BINDING_EVENT_DOMAIN = 'agritrace:binding-event:b1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const INT64_MAX = 9223372036854775807n;

export type BindingLogicalTuple = {
  network: string;
  channelId: string;
  chaincodeName: string;
  contractName: string;
  chainRef: string;
  envelopeVersion: string;
  writerAuthority: string;
  writerMspId: string;
  writerRole: string;
  governanceDigest: string;
};

/** Immutable logical binding: endpoints, hosts, credentials and cert revisions
 * are deliberately outside the digest so hosting/rotation never forks a ledger. */
export function bindingDigest(binding: BindingLogicalTuple): string {
  for (const field of [
    'network',
    'channelId',
    'chaincodeName',
    'contractName',
    'writerAuthority',
    'writerMspId',
    'writerRole',
  ] as const)
    if (!NAME.test(binding[field]))
      throw new Error(`Invalid binding field ${field}`);
  if (!UUID.test(binding.chainRef)) throw new Error('Invalid chainRef');
  if (!HASH.test(binding.governanceDigest))
    throw new Error('Invalid governanceDigest');
  if (binding.envelopeVersion !== B_ENVELOPE_VERSION)
    throw new Error('Binding requires envelope 4.0.0');
  if (binding.writerRole !== 'relayer')
    throw new Error('Binding writer must be a relayer');
  return canonicalSha256({
    protocol: BINDING_PROTOCOL,
    network: binding.network,
    channelId: binding.channelId,
    chaincodeName: binding.chaincodeName,
    contractName: binding.contractName,
    chainRef: binding.chainRef,
    envelopeVersion: binding.envelopeVersion,
    writerAuthority: binding.writerAuthority,
    writerMspId: binding.writerMspId,
    writerRole: binding.writerRole,
    governanceDigest: binding.governanceDigest,
  });
}

/** Canonical positive decimal string, no float round-trip, within int64. */
export function canonicalPositiveInt(value: string | number | bigint): string {
  const text = typeof value === 'string' ? value : value.toString();
  if (!/^[1-9][0-9]{0,18}$/.test(text))
    throw new Error('Expected a canonical positive decimal string');
  if (BigInt(text) > INT64_MAX) throw new Error('Value exceeds int64');
  return text;
}

export type PermissionRef = {
  permissionRef: string;
  epoch: string;
  ordinal: string;
};

export type BindingEventContext = {
  eventId: string;
  entityType: string;
  entityId: string;
  cycleId: string | null;
  lotId: string | null;
  eventType: string;
  eventTime: Date;
  previousEventHash: string | null;
  bindingDigest: string;
  chainRef: string;
  permissions: PermissionRef[];
};

/** Digest of the private body: exactly the release-A V2 canonical shape, so
 * API, Worker and operators recompute it from the stored private row. */
export function privateBodyDigest(event: TraceHashInput): string {
  return calculateTraceEventHash({
    ...event,
    schemaVersion: '2.0.0',
    canonicalizationVersion: 'RFC8785',
  });
}

export function unsignedBindingBody(
  context: BindingEventContext,
  bodyDigest: string,
  versions: { envelope: string; schema: string } = {
    envelope: B_ENVELOPE_VERSION,
    schema: B_SCHEMA_VERSION,
  },
) {
  if (!UUID.test(context.eventId)) throw new Error('Invalid eventId');
  for (const hash of [bodyDigest, context.bindingDigest])
    if (!HASH.test(hash)) throw new Error('Invalid digest');
  if (
    context.previousEventHash !== null &&
    !HASH.test(context.previousEventHash)
  )
    throw new Error('Invalid previousEventHash');
  if (!UUID.test(context.chainRef)) throw new Error('Invalid chainRef');
  if (context.permissions.length < 1 || context.permissions.length > 16)
    throw new Error('Expected 1-16 permissions');
  const permissions = context.permissions
    .map((permission) => {
      if (!UUID.test(permission.permissionRef))
        throw new Error('Invalid permissionRef');
      return {
        permissionRef: permission.permissionRef,
        epoch: canonicalPositiveInt(permission.epoch),
        ordinal: canonicalPositiveInt(permission.ordinal),
      };
    })
    .sort((a, b) => (a.permissionRef < b.permissionRef ? -1 : 1));
  for (let i = 1; i < permissions.length; i += 1)
    if (permissions[i].permissionRef === permissions[i - 1].permissionRef)
      throw new Error('Duplicate permissionRef');
  return {
    envelopeVersion: versions.envelope,
    schemaVersion: versions.schema,
    canonicalizationVersion: 'RFC8785',
    eventId: context.eventId,
    nonce: context.eventId,
    entityType: context.entityType,
    entityId: context.entityId,
    cycleId: context.cycleId,
    lotId: context.lotId,
    eventType: context.eventType,
    eventTime: context.eventTime.toISOString(),
    previousEventHash: context.previousEventHash,
    privateBodyDigest: bodyDigest,
    bindingDigest: context.bindingDigest,
    chainRef: context.chainRef,
    permissions,
  };
}

/** TraceEvent.dataHash for a B event: domain-separated SHA-256 over the
 * public unsigned body. The chaincode recomputes it from the public tuple. */
export function bindingEventCommitment(
  context: BindingEventContext,
  bodyDigest: string,
): string {
  const serialized = canonicalize(unsignedBindingBody(context, bodyDigest));
  return createHash('sha256')
    .update(BINDING_EVENT_DOMAIN, 'utf8')
    .update(Buffer.from([0]))
    .update(serialized, 'utf8')
    .digest('hex');
}
