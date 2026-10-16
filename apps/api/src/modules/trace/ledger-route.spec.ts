import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fixtureRoute,
  useFixtureRoute,
} from '../../../test/support/ledger-route-fixture.js';
import { FabricAdapterProvider } from '../blockchain-adapter/fabric-adapter.provider.js';
import {
  configuredWriteRoute,
  ledgerRouteDigest,
  routeProofMatches,
  verifiedEventRoute,
} from './ledger-route.js';

beforeEach(() => useFixtureRoute());
afterEach(() => vi.unstubAllEnvs());

describe('Immutable logical ledger routes', () => {
  const event = {
    dataHash: 'a'.repeat(64),
    ledgerRoute: {
      definitionDigest: fixtureRoute.digest,
      definition: fixtureRoute,
    },
  };
  it('checks proofs against their own route after current channel configuration changes', () => {
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
  it('rejects database content changed under a stored digest', () => {
    expect(
      verifiedEventRoute({
        ...event,
        ledgerRoute: {
          ...event.ledgerRoute,
          definition: { ...fixtureRoute, channelId: 'forged' },
        },
      }),
    ).toBeNull();
    expect(verifiedEventRoute({ dataHash: event.dataHash })).toBeNull();
  });
  it('accepts only a WRITE route with a complete writer authority', () => {
    expect(ledgerRouteDigest(fixtureRoute)).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      ledgerRouteDigest({ ...fixtureRoute, mode: 'HISTORICAL' }),
    ).toThrow('Unsupported');
    expect(() =>
      ledgerRouteDigest({ ...fixtureRoute, writerMspId: null }),
    ).toThrow('authority');
  });
  it('never verifies an event that has no route of its own', () => {
    const legacy = { dataHash: event.dataHash, ledgerRoute: null };
    expect(routeProofMatches(legacy, { dataHash: event.dataHash })).toBe(false);
    expect(routeProofMatches(legacy, { dataHash: 'b'.repeat(64) })).toBe(false);
    expect(
      routeProofMatches(
        { dataHash: event.dataHash },
        { dataHash: event.dataHash },
      ),
    ).toBe(false);
  });
  it('derives a different digest when the configured destination changes', () => {
    const moved = configuredWriteRoute({
      ...process.env,
      FABRIC_CHANNEL_NAME: 'another-channel',
    });
    expect(moved.digest).not.toBe(fixtureRoute.digest);
    expect(() =>
      configuredWriteRoute({
        ...process.env,
        FABRIC_CHANNEL_NAME: 'bad channel',
      }),
    ).toThrow('destination');
  });
  it('captures the gateway destination once so changed env cannot relabel a cached connection', () => {
    vi.stubEnv('FABRIC_SAMPLES_DIR', 'isolated-network');
    vi.stubEnv('FABRIC_MSP_ID', fixtureRoute.writerMspId!);
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
