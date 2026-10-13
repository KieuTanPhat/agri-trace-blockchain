import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureRoute } from '../../../test/support/ledger-route-fixture.js';
import { ledgerRouteDigest, routeProofMatches, verifiedEventRoute } from './ledger-route.js';
import { loadLegacyLedgerDescriptor, parseLegacyLedgerDescriptor } from './legacy-ledger-descriptor.js';

const historical = {
  ...fixtureRoute, mode: 'HISTORICAL', writerAuthority: null, writerMspId: null, writerRole: null,
};
const route = { ...historical, digest: ledgerRouteDigest(historical) };
const event = {
  id: 'd093ee99-82d2-43ee-bf7a-f8fb868eb5b9', dataHash: 'a'.repeat(64), schemaVersion: '2.0.0',
  ledgerRoute: null, ledgerRouteExemption: { eventId: 'd093ee99-82d2-43ee-bf7a-f8fb868eb5b9' },
};
const descriptor = {
  protocol: 'agritrace-legacy-ledger/1', routes: [route],
  events: [{ eventId: event.id, dataHash: event.dataHash, routeDigest: route.digest, envelopeVersion: '3.0.0' }],
};
const directories: string[] = [];
function pin(value: unknown = descriptor) {
  const directory = mkdtempSync(join(tmpdir(), 'agritrace-descriptor-test-'));
  directories.push(directory);
  const file = join(directory, 'descriptor.json');
  const bytes = JSON.stringify(value);
  writeFileSync(file, bytes);
  vi.stubEnv('LEGACY_LEDGER_DESCRIPTOR_FILE', file);
  vi.stubEnv('LEGACY_LEDGER_DESCRIPTOR_SHA256', createHash('sha256').update(bytes).digest('hex'));
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Trusted finite legacy ledger baseline', () => {
  it('resolves the original ledger with null historical authority after writer configuration changes', () => {
    pin();
    vi.stubEnv('FABRIC_CHANNEL_NAME', 'new-hosted-channel');
    expect(verifiedEventRoute(event)).toEqual(route);
    expect(routeProofMatches(event, { ...route, dataHash: event.dataHash })).toBe(true);
    expect(routeProofMatches(event, { ...route, channelId: 'new-hosted-channel', dataHash: event.dataHash })).toBe(false);
    expect(verifiedEventRoute(event)?.writerAuthority).toBeNull();
  });
  it('fails closed for changed hashes, uncaptured events, unknown versions and unloaded exemptions', () => {
    pin();
    for (const invalid of [
      { ...event, dataHash: 'b'.repeat(64) },
      { ...event, id: '234a343e-deb7-4666-ae04-55bd3918aaff' },
      { ...event, schemaVersion: '5.0.0' },
      { ...event, ledgerRouteExemption: undefined },
      { ...event, ledgerRouteExemption: null },
      { ...event, ledgerRoute: undefined },
    ]) expect(verifiedEventRoute(invalid)).toBeNull();
  });
  it('rejects a missing or mismatched independent pin and altered file bytes', () => {
    pin();
    const file = process.env.LEGACY_LEDGER_DESCRIPTOR_FILE!;
    writeFileSync(file, `${JSON.stringify(descriptor)}\n`);
    expect(verifiedEventRoute(event)).toBeNull();
    expect(() => loadLegacyLedgerDescriptor()).toThrow('SHA256 mismatch');
    vi.stubEnv('LEGACY_LEDGER_DESCRIPTOR_SHA256', '');
    expect(() => loadLegacyLedgerDescriptor()).toThrow('independent SHA256');
  });
  it('preserves the route of known pre-envelope history without asserting its private hash or organization authority', () => {
    const oldRoute = { ...route, envelopeVersion: '2.0.0' };
    oldRoute.digest = ledgerRouteDigest(oldRoute);
    pin({ ...descriptor, routes: [oldRoute], events: [{ ...descriptor.events[0], routeDigest: oldRoute.digest, envelopeVersion: '2.0.0' }] });
    expect(verifiedEventRoute({ ...event, schemaVersion: 'trace-event-1' })).toEqual(oldRoute);
    expect(verifiedEventRoute({ ...event, schemaVersion: 'trace-event-1' })?.writerMspId).toBeNull();
  });
  it('rejects duplicate inventory and an authority upgrade on historical records', () => {
    expect(() => parseLegacyLedgerDescriptor({ ...descriptor, events: [...descriptor.events, ...descriptor.events] })).toThrow('duplicate');
    expect(() => parseLegacyLedgerDescriptor({ ...descriptor, routes: [fixtureRoute] })).toThrow('historical');
  });
});
