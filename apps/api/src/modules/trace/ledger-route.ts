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
  dataHash: string;
  ledgerRoute?: null | { definitionDigest: string; definition: PinnedRoute };
};
export const EVENT_LEDGER_ROUTE_INCLUDE = {
  include: { definition: true },
} as const;

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

export function ledgerRouteDigest(route: RouteDefinition): string {
  const payload = routePayload(route);
  for (const field of [
    'network',
    'channelId',
    'chaincodeName',
    'contractName',
  ] as const)
    if (
      typeof payload[field] !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(payload[field])
    )
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
  if (!(
    authority.every((value) => value === null) ||
    authority.every(
      (value) =>
        typeof value === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value),
    )
  ))
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

/** Deployment-owned metadata, independent of database rows; no credential paths. */
export function ledgerRoutePins(
  environment: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const raw = environment.LEDGER_ROUTE_PINS;
  if (!raw || raw.length > 20000) throw new Error('Missing ledger route pins');
  const pins: unknown = JSON.parse(raw);
  if (
    !Array.isArray(pins) ||
    pins.length === 0 ||
    pins.length > 256 ||
    pins.some(
      (pin) => typeof pin !== 'string' || !/^[a-f0-9]{64}$/.test(pin),
    ) ||
    new Set(pins).size !== pins.length
  )
    throw new Error('Invalid ledger route pins');
  return new Set(pins as string[]);
}

export function assertPinnedLedgerRoute(
  route: PinnedRoute,
  pins = ledgerRoutePins(),
): PinnedRoute {
  if (!pins.has(route.digest) || ledgerRouteDigest(route) !== route.digest)
    throw new Error('Unverified ledger route definition');
  return route;
}

export function verifiedEventRoute(event: RoutedEvent): PinnedRoute | null {
  try {
    const sidecar = event.ledgerRoute;
    if (!sidecar || sidecar.definitionDigest !== sidecar.definition.digest)
      return null;
    return assertPinnedLedgerRoute(sidecar.definition);
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

export async function activeWriteRoute(
  tx: Prisma.TransactionClient,
): Promise<PinnedRoute> {
  try {
    const digest = process.env.LEDGER_ACTIVE_ROUTE_DIGEST;
    if (
      !digest ||
      !/^[a-f0-9]{64}$/.test(digest) ||
      !ledgerRoutePins().has(digest)
    )
      throw new Error('Missing active ledger route');
    await tx.$queryRaw`SELECT digest FROM ledger_route_definition WHERE digest=${digest} FOR SHARE`;
    const route = await tx.ledgerRouteDefinition.findUniqueOrThrow({
      where: { digest },
    });
    assertPinnedLedgerRoute(route);
    if (route.mode !== 'WRITE')
      throw new Error('Historical route is read only');
    return route;
  } catch {
    throw new ServiceUnavailableException(
      'Ledger route chưa được đăng ký và pin hợp lệ',
    );
  }
}
