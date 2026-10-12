import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fixtureRoute,
  fixtureRoutePins,
} from '../../../test/support/ledger-route-fixture.js';
import { FabricAdapterProvider } from '../blockchain-adapter/fabric-adapter.provider.js';
import {
  ledgerRouteDigest,
  ledgerRoutePins,
  routeProofMatches,
  verifiedEventRoute,
} from './ledger-route.js';

beforeEach(() => {
  vi.stubEnv('LEDGER_ROUTE_PINS', JSON.stringify([fixtureRoute.digest]));
  vi.stubEnv('LEDGER_ACTIVE_ROUTE_DIGEST', fixtureRoute.digest);
  fixtureRoutePins();
});
afterEach(() => vi.unstubAllEnvs());

describe('Immutable logical ledger routes', () => {
  const event = {
    dataHash: 'a'.repeat(64),
    ledgerRoute: {
      definitionDigest: fixtureRoute.digest,
      definition: fixtureRoute,
    },
  };
  it('checks historical proofs against their route after current channel configuration changes', () => {
    vi.stubEnv('FABRIC_CHANNEL_NAME', 'another-channel');
    vi.stubEnv('FABRIC_NETWORK_NAME', 'another-network');
    expect(
      routeProofMatches(event, {
        network: fixtureRoute.network,
        channelId: fixtureRoute.channelId,
        dataHash: event.dataHash,
      }),
    ).toBe(true);
    expect(
      routeProofMatches(event, {
        network: 'another-network',
        channelId: 'another-channel',
        dataHash: event.dataHash,
      }),
    ).toBe(false);
  });
  it('rejects database content changed under a pinned digest and missing historical pins', () => {
    expect(
      verifiedEventRoute({
        ...event,
        ledgerRoute: {
          ...event.ledgerRoute,
          definition: { ...fixtureRoute, channelId: 'forged' },
        },
      }),
    ).toBeNull();
    vi.stubEnv('LEDGER_ROUTE_PINS', JSON.stringify(['b'.repeat(64)]));
    expect(verifiedEventRoute(event)).toBeNull();
    expect(verifiedEventRoute({ dataHash: event.dataHash })).toBeNull();
  });
  it('keeps unattested historical authority nullable and rejects it as a writer', () => {
    const historical = {
      ...fixtureRoute,
      mode: 'HISTORICAL',
      envelopeVersion: null,
      writerAuthority: null,
      writerMspId: null,
      writerRole: null,
    };
    expect(ledgerRouteDigest(historical)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => ledgerRouteDigest({ ...historical, mode: 'WRITE' })).toThrow(
      'Incompatible',
    );
    expect(() =>
      ledgerRouteDigest({ ...historical, writerMspId: 'ForgedMSP' }),
    ).toThrow('authority');
  });
  it('rejects missing, duplicate and malformed independent pins without defaults', () => {
    for (const value of [
      undefined,
      '[]',
      '{}',
      JSON.stringify([fixtureRoute.digest, fixtureRoute.digest]),
      JSON.stringify(['not-a-digest']),
    ])
      expect(() => ledgerRoutePins({ LEDGER_ROUTE_PINS: value })).toThrow();
  });
  it('captures the gateway destination once so changed env cannot relabel a cached connection', () => {
    vi.stubEnv('FABRIC_SAMPLES_DIR', 'isolated-network');
    vi.stubEnv('RELAYER_MSP_DIR', 'isolated-identity-reference');
    vi.stubEnv('FABRIC_NETWORK_NAME', fixtureRoute.network);
    vi.stubEnv('FABRIC_CHANNEL_NAME', fixtureRoute.channelId);
    vi.stubEnv('LEDGER_WRITER_AUTHORITY', fixtureRoute.writerAuthority!);
    const provider = new FabricAdapterProvider();
    const captured = provider.getWriterRoute();
    vi.stubEnv('FABRIC_CHANNEL_NAME', 'changed-channel');
    expect(provider.getWriterRoute()).toBe(captured);
    expect(provider.getWriterRoute().channelId).toBe(fixtureRoute.channelId);
  });
});
