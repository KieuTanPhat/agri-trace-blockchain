import { ServiceUnavailableException } from '@nestjs/common';
import type {
  LedgerRouteDefinition,
  Prisma,
} from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';

export const ROUTE_PROTOCOL = 'agritrace-ledger-route/1';
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
>;
export type PinnedRoute = RouteDefinition & { digest: string };
export type RoutedEvent = {
  id?: string;
  dataHash: string;
  ledgerRoute?: null | {
    definitionDigest: string;
    definition: PinnedRoute;
  };
};
export const EVENT_LEDGER_ROUTE_INCLUDE = {
  include: { definition: true },
} as const;

const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export function routePayload(route: RouteDefinition): RouteDefinition {
  return {
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
    payload.protocol !== ROUTE_PROTOCOL ||
    !['WRITE', 'HISTORICAL'].includes(payload.mode)
  )
    throw new Error('Unsupported ledger route protocol');
  const authority = [
    payload.writerAuthority,
    payload.writerMspId,
    payload.writerRole,
  ];
  if (
    !(
      authority.every((value) => value === null) ||
      authority.every((value) => typeof value === 'string' && NAME.test(value))
    )
  )
    throw new Error('Invalid ledger writer authority');
  if (payload.writerRole !== null && payload.writerRole.length > 50)
    throw new Error('Invalid ledger writer role');
  if (
    payload.envelopeVersion !== null &&
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/.test(payload.envelopeVersion)
  )
    throw new Error('Invalid ledger envelope version');
  if (
    payload.mode === 'WRITE' &&
    (payload.envelopeVersion !== '3.0.0' ||
      authority.some((value) => value === null) ||
      payload.writerRole !== 'relayer')
  )
    throw new Error('Incompatible ledger writer route');
  return canonicalSha256(payload);
}

/** The single release-A write destination, shared by API and Worker. Both
 * processes derive it from the same deployment variables; the Worker only
 * delivers events whose immutable route equals its own destination. */
export function configuredWriteRoute(
  env: NodeJS.ProcessEnv = process.env,
): PinnedRoute {
  const route: RouteDefinition = {
    protocol: ROUTE_PROTOCOL,
    mode: 'WRITE',
    network: env.FABRIC_NETWORK_NAME || 'hyperledger-fabric',
    channelId: env.FABRIC_CHANNEL_NAME || 'agritrace',
    chaincodeName: env.FABRIC_CHAINCODE_NAME || 'agritrace',
    contractName: env.FABRIC_CONTRACT_NAME || 'AgriTraceContract',
    envelopeVersion: '3.0.0',
    writerAuthority: env.LEDGER_WRITER_AUTHORITY || 'agritrace-relayer',
    writerMspId: env.FABRIC_MSP_ID || 'Org1MSP',
    writerRole: 'relayer',
  };
  return Object.freeze({ ...route, digest: ledgerRouteDigest(route) });
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

/** Pre-release-A events (loaded route sidecar is `null`) are verified as
 * before: their proof carries the destination. An unloaded sidecar
 * (`undefined`) never verifies, so a query cannot silently downgrade. */
export function routeProofMatches(
  event: RoutedEvent,
  proof: { network?: string; channelId?: string; dataHash: string },
): boolean {
  if (event.ledgerRoute === null) return proof.dataHash === event.dataHash;
  const route = verifiedEventRoute(event);
  return Boolean(
    route &&
    proof.dataHash === event.dataHash &&
    proof.network === route.network &&
    proof.channelId === route.channelId,
  );
}

/** Register (idempotently) and return the current write route. Definitions
 * are immutable rows keyed by digest, so concurrent registration is safe. */
export async function activeWriteRoute(
  tx: Prisma.TransactionClient,
): Promise<PinnedRoute> {
  let route: PinnedRoute;
  try {
    route = configuredWriteRoute();
  } catch {
    throw new ServiceUnavailableException('Ledger route cấu hình không hợp lệ');
  }
  await tx.$executeRaw`INSERT INTO ledger_route_definition
    (digest, protocol, mode, network, channel_id, chaincode_name, contract_name,
     envelope_version, writer_authority, writer_msp_id, writer_role)
    VALUES (${route.digest}, ${route.protocol}, ${route.mode}, ${route.network},
      ${route.channelId}, ${route.chaincodeName}, ${route.contractName},
      ${route.envelopeVersion}, ${route.writerAuthority}, ${route.writerMspId},
      ${route.writerRole})
    ON CONFLICT (digest) DO NOTHING`;
  return route;
}
