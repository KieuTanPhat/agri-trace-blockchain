import { randomUUID } from 'node:crypto';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { fixtureRoute } from '../../../test/support/ledger-route-fixture.js';
import { verifiedEventRoute } from './ledger-route.js';
import {
  ROUTE_IMPORT_PROTOCOL,
  WRITER_SNAPSHOT_PROTOCOL,
  routeImportPins,
  validateRouteImportArtifact,
  verifiedRouteImportArtifact,
  type RouteImportArtifact,
} from './ledger-route-import-artifact.js';

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const artifact: RouteImportArtifact = {
    protocol: ROUTE_IMPORT_PROTOCOL,
    id: randomUUID(),
    environment: 'isolated',
    sourceSha: 'a'.repeat(40),
    inventoryDigest: 'b'.repeat(64),
    reviewEvidenceDigest: 'c'.repeat(64),
    entries: [
      {
        eventId: randomUUID(),
        dataHash: 'd'.repeat(64),
        eventRowDigest: 'e'.repeat(64),
        snapshotDigest: 'f'.repeat(64),
        definitionDigest: fixtureRoute.digest,
        evidence: { kind: 'PROOF', digest: '1'.repeat(64) },
      },
    ],
  };
  const pin = {
    digest: canonicalSha256(artifact),
    sourceSha: artifact.sourceSha,
    environment: artifact.environment,
  };
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('LEDGER_ROUTE_PINS', JSON.stringify([fixtureRoute.digest]));
  vi.stubEnv('LEDGER_ROUTE_IMPORT_PINS', JSON.stringify([pin]));
  return { artifact, record: { ...pin, artifact }, pin };
}
describe('Independently pinned legacy route provenance', () => {
  it('requires canonical artifact and matching event/hash/definition in proof readers', () => {
    const { artifact, record } = fixture();
    const entry = artifact.entries[0];
    const event = {
      id: entry.eventId,
      dataHash: entry.dataHash,
      ledgerRoute: {
        definitionDigest: fixtureRoute.digest,
        definition: fixtureRoute,
        importDigest: record.digest,
        import: record,
      },
    };
    expect(verifiedEventRoute(event)).toEqual(fixtureRoute);
    expect(verifiedEventRoute({ ...event, id: randomUUID() })).toBeNull();
    expect(
      verifiedEventRoute({ ...event, dataHash: '9'.repeat(64) }),
    ).toBeNull();
    record.artifact = { ...artifact, reviewEvidenceDigest: '0'.repeat(64) };
    expect(verifiedEventRoute(event)).toBeNull();
  });
  it('holds a withdrawn import pin even when the route definition stays pinned', () => {
    const { record } = fixture();
    expect(verifiedRouteImportArtifact(record)).toEqual(record.artifact);
    vi.stubEnv('LEDGER_ROUTE_IMPORT_PINS', '[]');
    expect(() => verifiedRouteImportArtifact(record)).toThrow();
  });
  it.each(['sourceSha', 'environment'] as const)(
    'rejects a mismatching %s in independent pins',
    (field) => {
      const { record, pin } = fixture();
      vi.stubEnv(
        'LEDGER_ROUTE_IMPORT_PINS',
        JSON.stringify([
          {
            ...pin,
            [field]: field === 'sourceSha' ? 'b'.repeat(40) : 'production',
          },
        ]),
      );
      expect(() => verifiedRouteImportArtifact(record)).toThrow();
    },
  );
  it('requires independent paused-writer pins, not just a descriptor stored in the artifact', () => {
    const { artifact } = fixture();
    const descriptor = {
      protocol: WRITER_SNAPSHOT_PROTOCOL,
      releaseSha: '2'.repeat(40),
      environment: artifact.environment,
      definitionDigest: fixtureRoute.digest,
      paused: true,
    } as const;
    const descriptorDigest = canonicalSha256(descriptor);
    artifact.entries[0].evidence = {
      kind: 'PAUSED_WRITER',
      descriptor,
      digest: descriptorDigest,
    };
    const record = {
      digest: canonicalSha256(artifact),
      sourceSha: artifact.sourceSha,
      environment: artifact.environment,
      artifact,
    };
    vi.stubEnv(
      'LEDGER_ROUTE_IMPORT_PINS',
      JSON.stringify([
        {
          digest: record.digest,
          sourceSha: record.sourceSha,
          environment: record.environment,
        },
      ]),
    );
    vi.stubEnv('LEDGER_PAUSED_WRITER_PINS', undefined);
    expect(() => verifiedRouteImportArtifact(record)).toThrow();
    vi.stubEnv('LEDGER_PAUSED_WRITER_PINS', JSON.stringify([descriptorDigest]));
    expect(verifiedRouteImportArtifact(record)).toEqual(artifact);
  });
  it('rejects duplicate IDs, private extra fields and oversized batches', () => {
    const { artifact } = fixture();
    expect(() =>
      validateRouteImportArtifact({ ...artifact, privateKey: 'forbidden' }),
    ).toThrow();
    expect(() =>
      validateRouteImportArtifact({
        ...artifact,
        entries: [artifact.entries[0], artifact.entries[0]],
      }),
    ).toThrow();
    expect(() =>
      validateRouteImportArtifact({
        ...artifact,
        entries: Array(1001).fill(artifact.entries[0]),
      }),
    ).toThrow();
  });
  it('rejects isolated metadata in production and malformed/duplicate pins', () => {
    const { pin } = fixture();
    expect(() =>
      routeImportPins({
        NODE_ENV: 'production',
        LEDGER_ROUTE_IMPORT_PINS: JSON.stringify([pin]),
      }),
    ).toThrow();
    expect(() =>
      routeImportPins({ LEDGER_ROUTE_IMPORT_PINS: JSON.stringify([pin, pin]) }),
    ).toThrow();
    expect(() => routeImportPins({ LEDGER_ROUTE_IMPORT_PINS: '{}' })).toThrow();
  });
});
