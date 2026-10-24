import type { LedgerRouteDefinition } from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';

/** Binding routes pin the chain reference and the logical binding digest. */
export const BINDING_ROUTE_PROTOCOL = 'agritrace-ledger-route/2';
export type RouteDefinition = Pick<
  LedgerRouteDefinition,
  | 'protocol'
  | 'mode'
  | 'network'
  | 'channelId'
  | 'chaincodeName'
  | 'contractName'
  | 'envelopeVersion'
  | 'writerAuthority'
  | 'writerMspId'
  | 'writerRole'
> & { chainRef?: string | null; bindingDigest?: string | null };
export type PinnedRoute = RouteDefinition & { digest: string };
export type RoutedEvent = {
  id?: string;
  schemaVersion?: string;
  dataHash: string;
  ledgerRoute?: null | {
    definitionDigest: string;
    definition: PinnedRoute;
  };
};
export const EVENT_LEDGER_ROUTE_INCLUDE = {
  include: { definition: true },
} as const;
/** Release B events carry their binding and captured permission epochs. */
export const EVENT_BINDING_CONTEXT_INCLUDE = {
  include: {
    binding: true,
    permissions: true,
    // Release C: independent organization signature, when the event has one.
    event: { select: { actorSignature: { include: { key: true } } } },
  },
} as const;

const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export function routePayload(route: RouteDefinition): RouteDefinition {
  return {
    chainRef: route.chainRef ?? null,
    bindingDigest: route.bindingDigest ?? null,
    protocol: route.protocol,
    mode: route.mode,
    network: route.network,
    channelId: route.channelId,
    chaincodeName: route.chaincodeName,
    contractName: route.contractName,
    envelopeVersion: route.envelopeVersion,
    writerAuthority: route.writerAuthority,
    writerMspId: route.writerMspId,
    writerRole: route.writerRole,
  };
}

/** Canonical digest of the logical destination and writer authority. It never
 * includes endpoints, credential paths or certificate revisions. */
export function ledgerRouteDigest(route: RouteDefinition): string {
  const payload = routePayload(route);
  for (const field of [
    'network',
    'channelId',
    'chaincodeName',
    'contractName',
  ] as const)
    if (typeof payload[field] !== 'string' || !NAME.test(payload[field]))
      throw new Error('Invalid ledger destination');
  if (
    payload.protocol !== BINDING_ROUTE_PROTOCOL ||
    payload.mode !== 'WRITE' ||
    payload.envelopeVersion !== '4.0.0' ||
    payload.writerRole !== 'relayer' ||
    payload.writerAuthority === null ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      payload.chainRef ?? '',
    ) ||
    !/^[a-f0-9]{64}$/.test(payload.bindingDigest ?? '')
  )
    throw new Error('Incompatible binding ledger route');
  return canonicalSha256(payload);
}

/** Recompute the digest of a stored route; a mismatch means the row is not
 * the definition it claims to be and the event must not be delivered. */
export function verifiedEventRoute(event: RoutedEvent): PinnedRoute | null {
  try {
    const sidecar = event.ledgerRoute;
    if (!sidecar || sidecar.definitionDigest !== sidecar.definition.digest)
      return null;
    if (ledgerRouteDigest(sidecar.definition) !== sidecar.definition.digest)
      return null;
    return sidecar.definition;
  } catch {
    return null;
  }
}

export function sameLedgerDestination(
  left: RouteDefinition,
  right: RouteDefinition,
): boolean {
  return ['network', 'channelId', 'chaincodeName', 'contractName'].every(
    (field) =>
      left[field as keyof RouteDefinition] ===
      right[field as keyof RouteDefinition],
  );
}

/** A proof is valid only for the destination fixed by the event's own route;
 * an event without a verified route never matches. */
export function routeProofMatches(
  event: RoutedEvent,
  proof: { network?: string; channelId?: string; dataHash: string },
): boolean {
  const route = verifiedEventRoute(event);
  return Boolean(
    route &&
    proof.dataHash === event.dataHash &&
    proof.network === route.network &&
    proof.channelId === route.channelId,
  );
}
