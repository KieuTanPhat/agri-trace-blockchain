import { describe, expect, it } from 'vitest';
import { fixtureRoute } from '../../../test/support/ledger-route-fixture.js';
import {
  ledgerRouteDigest,
  routeProofMatches,
  verifiedEventRoute,
} from './ledger-route.js';

describe('Immutable logical ledger routes', () => {
  const event = {
    dataHash: 'a'.repeat(64),
    ledgerRoute: {
      definitionDigest: fixtureRoute.digest,
      definition: fixtureRoute,
    },
  };
  it('checks proofs against the destination fixed by their own route', () => {
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
  it('accepts only a binding WRITE route with a complete writer authority', () => {
    expect(ledgerRouteDigest(fixtureRoute)).toMatch(/^[a-f0-9]{64}$/);
    for (const change of [
      { mode: 'HISTORICAL' },
      { protocol: 'agritrace-ledger-route/1' },
      { envelopeVersion: '3.0.0' },
      { writerAuthority: null },
      { bindingDigest: null },
    ])
      expect(() => ledgerRouteDigest({ ...fixtureRoute, ...change })).toThrow(
        'Incompatible',
      );
    expect(() =>
      ledgerRouteDigest({ ...fixtureRoute, channelId: 'bad channel' }),
    ).toThrow('destination');
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
});
