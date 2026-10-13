import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import {
  ledgerRouteDigest,
  ROUTE_PROTOCOL,
  type PinnedRoute,
  type RoutedEvent,
} from './ledger-route.js';

export const LEGACY_LEDGER_PROTOCOL = 'agritrace-legacy-ledger/1';
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export interface LegacyLedgerEvent {
  eventId: string;
  dataHash: string;
  routeDigest: string;
  envelopeVersion: string;
}

export interface LegacyLedgerDescriptor {
  protocol: typeof LEGACY_LEDGER_PROTOCOL;
  routes: PinnedRoute[];
  events: LegacyLedgerEvent[];
}
const inventories = new WeakMap<LegacyLedgerDescriptor, {
  routes: Map<string, PinnedRoute>; events: Map<string, LegacyLedgerEvent>;
}>();
const cached = new Map<string, { stamp: string; descriptor: LegacyLedgerDescriptor }>();

/** An independently pinned finite baseline inventory. Neither current writer
 * configuration nor an event's untrusted stored proof supplies its route. */
export function loadLegacyLedgerDescriptor(
  env: NodeJS.ProcessEnv = process.env,
): LegacyLedgerDescriptor | null {
  const file = env.LEGACY_LEDGER_DESCRIPTOR_FILE;
  const pin = env.LEGACY_LEDGER_DESCRIPTOR_SHA256;
  if (!file && !pin) return null;
  if (!file || !pin || !HEX.test(pin))
    throw new Error('Legacy ledger descriptor requires its independent SHA256 pin');
  const stat = statSync(file, { bigint: true });
  const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  const key = `${file}\0${pin}`;
  const prior = cached.get(key);
  if (prior?.stamp === stamp) return prior.descriptor;
  const bytes = readFileSync(file);
  if (bytes.length > 8 * 1024 * 1024)
    throw new Error('Legacy ledger descriptor exceeds the inventory limit');
  if (createHash('sha256').update(bytes).digest('hex') !== pin)
    throw new Error('Legacy ledger descriptor SHA256 mismatch');
  const descriptor = parseLegacyLedgerDescriptor(JSON.parse(bytes.toString('utf8')) as unknown);
  if (cached.size >= 8) cached.clear();
  cached.set(key, { stamp, descriptor });
  return descriptor;
}

export function parseLegacyLedgerDescriptor(value: unknown): LegacyLedgerDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid legacy ledger descriptor');
  const descriptor = value as LegacyLedgerDescriptor;
  if (descriptor.protocol !== LEGACY_LEDGER_PROTOCOL ||
      !Array.isArray(descriptor.routes) || !Array.isArray(descriptor.events))
    throw new Error('Unsupported legacy ledger descriptor');
  const routes = new Map<string, PinnedRoute>();
  for (const route of descriptor.routes) {
    if (!route || route.protocol !== ROUTE_PROTOCOL || route.mode !== 'HISTORICAL' ||
        route.writerAuthority !== null || route.writerMspId !== null || route.writerRole !== null ||
        route.chainRef != null || route.bindingDigest != null ||
        !HEX.test(route.digest) || ledgerRouteDigest(route) !== route.digest || routes.has(route.digest))
      throw new Error('Invalid or attested legacy historical route');
    routes.set(route.digest, route);
  }
  const ids = new Set<string>();
  const events = new Map<string, LegacyLedgerEvent>();
  for (const event of descriptor.events) {
    const route = routes.get(event?.routeDigest);
    if (!event || !UUID.test(event.eventId) || !HEX.test(event.dataHash) ||
        !route || ids.has(event.eventId) ||
        typeof event.envelopeVersion !== 'string' ||
        !['2.0.0', '3.0.0'].includes(event.envelopeVersion) ||
        event.envelopeVersion !== route.envelopeVersion)
      throw new Error('Invalid or duplicate legacy event inventory');
    ids.add(event.eventId);
    events.set(event.eventId, Object.freeze(event));
  }
  for (const route of routes.values()) Object.freeze(route);
  Object.freeze(descriptor.events);
  Object.freeze(descriptor.routes);
  Object.freeze(descriptor);
  inventories.set(descriptor, { routes, events });
  return descriptor;
}

/** A missing sidecar can only resolve for an event in both the sealed DB set
 * and the reviewed external baseline. New events never become historical. */
export function historicalEventRoute(
  event: RoutedEvent,
  env: NodeJS.ProcessEnv = process.env,
): PinnedRoute | null {
  if (event.ledgerRoute !== null || !event.id ||
      event.ledgerRouteExemption?.eventId !== event.id) return null;
  try {
    const descriptor = loadLegacyLedgerDescriptor(env);
    if (!descriptor) return null;
    const inventory = inventories.get(descriptor);
    const captured = inventory?.events.get(event.id);
    // The ledger preserves pre-envelope v2 and core v3 records. Old DB defaults
    // trace-event-1 are recognized as historical metadata only: the private
    // evidence reader still reports their existing warning instead of inventing
    // a verified hash or organization signature.
    if (!captured || captured.dataHash !== event.dataHash ||
        !['trace-event-1', '2.0.0'].includes(event.schemaVersion ?? '') ||
        !['2.0.0', '3.0.0'].includes(captured.envelopeVersion)) return null;
    return inventory?.routes.get(captured.routeDigest) ?? null;
  } catch {
    return null;
  }
}
