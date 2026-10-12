import { randomUUID } from 'node:crypto';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import {
  validateLegacyScopeManifest,
  type LegacyScopeInventory,
  type LegacyScopeManifest,
} from './legacy-scope-manifest.js';

const expected = {
  environment: 'isolated' as const,
  sourceSha: 'a'.repeat(40),
};
function fixture() {
  const roots = [true, false]
    .map((active) => ({
      cycleId: randomUUID(),
      producerOrgId: randomUUID(),
      version: 3,
      active,
      inventoryDigest: 'b'.repeat(64),
      counts: { traceEvents: 5, proofs: 5 },
    }))
    .sort((a, b) => a.cycleId.localeCompare(b.cycleId));
  const body = { schema: 'agritrace-legacy-inventory-1' as const, roots };
  const inventory: LegacyScopeInventory = {
    ...body,
    digest: canonicalSha256(body),
  };
  const manifest: LegacyScopeManifest = {
    schema: 'agritrace-legacy-scope-manifest-1',
    id: randomUUID(),
    ...expected,
    inventoryDigest: inventory.digest,
    operatorId: randomUUID(),
    reviewerId: randomUUID(),
    reviewEvidenceDigest: 'c'.repeat(64),
    entries: roots.map((root) => ({
      cycleId: root.cycleId,
      producerOrgId: root.producerOrgId,
      expectedVersion: root.version,
      inventoryDigest: root.inventoryDigest,
      decision: 'UNRESOLVED',
      chainId: null,
    })),
  };
  return { manifest, inventory, pin: canonicalSha256(manifest) };
}

describe('Independent legacy scope manifest validation', () => {
  it('accepts a versioned root-specific supersession only in the independently pinned new artifact', () => {
    const { manifest, inventory } = fixture();
    manifest.schema = 'agritrace-legacy-scope-manifest-2';
    manifest.supersedes = [
      {
        manifestId: randomUUID(),
        manifestDigest: 'd'.repeat(64),
        cycleId: manifest.entries[0].cycleId,
      },
    ];
    const pin = canonicalSha256(manifest);
    expect(
      validateLegacyScopeManifest(manifest, inventory, pin, expected).digest,
    ).toBe(pin);
    manifest.supersedes[0].manifestDigest = 'e'.repeat(64);
    expect(() =>
      validateLegacyScopeManifest(manifest, inventory, pin, expected),
    ).toThrow('pin mismatch');
  });
  it.each(['duplicate', 'self', 'foreign-root', 'v1-field'] as const)(
    'rejects %s supersession metadata before DB registration',
    (bad) => {
      const { manifest, inventory } = fixture();
      manifest.schema = 'agritrace-legacy-scope-manifest-2';
      manifest.supersedes = [
        {
          manifestId: randomUUID(),
          manifestDigest: 'd'.repeat(64),
          cycleId: manifest.entries[0].cycleId,
        },
      ];
      if (bad === 'duplicate')
        manifest.supersedes.push({ ...manifest.supersedes[0] });
      if (bad === 'self') manifest.supersedes[0].manifestId = manifest.id;
      if (bad === 'foreign-root') manifest.supersedes[0].cycleId = randomUUID();
      if (bad === 'v1-field')
        manifest.schema = 'agritrace-legacy-scope-manifest-1';
      expect(() =>
        validateLegacyScopeManifest(
          manifest,
          inventory,
          canonicalSha256(manifest),
          expected,
        ),
      ).toThrow();
    },
  );
  it('keeps unresolved decisions explicit and blocks active roots from cutover', () => {
    const { manifest, inventory, pin } = fixture();
    const result = validateLegacyScopeManifest(
      manifest,
      inventory,
      pin,
      expected,
    );
    expect(result.mapped).toBe(0);
    expect(result.activeUnresolved).toEqual(
      inventory.roots.filter((r) => r.active).map((r) => r.cycleId),
    );
  });
  it('accepts explicit mapping only with the independently pinned artifact', () => {
    const { manifest, inventory } = fixture();
    manifest.entries[0].decision = 'MAP';
    manifest.entries[0].chainId = randomUUID();
    expect(
      validateLegacyScopeManifest(
        manifest,
        inventory,
        canonicalSha256(manifest),
        expected,
      ).mapped,
    ).toBe(1);
  });
  it('rejects changing a target and recomputing a digest inside the artifact', () => {
    const { manifest, inventory, pin } = fixture();
    manifest.entries[0].decision = 'MAP';
    manifest.entries[0].chainId = randomUUID();
    expect(() =>
      validateLegacyScopeManifest(manifest, inventory, pin, expected),
    ).toThrow('pin mismatch');
  });
  it('rejects an omitted legacy root instead of treating it as implicitly mapped', () => {
    const { manifest, inventory } = fixture();
    manifest.entries.pop();
    expect(() =>
      validateLegacyScopeManifest(
        manifest,
        inventory,
        canonicalSha256(manifest),
        expected,
      ),
    ).toThrow('every legacy root');
  });
  it('rejects duplicate roots even when the count and pin agree', () => {
    const { manifest, inventory } = fixture();
    manifest.entries[1] = { ...manifest.entries[0] };
    expect(() =>
      validateLegacyScopeManifest(
        manifest,
        inventory,
        canonicalSha256(manifest),
        expected,
      ),
    ).toThrow('duplicate or unsorted');
  });
  it('rejects a stale stock/version/proof inventory before mutation', () => {
    const { manifest, inventory, pin } = fixture();
    inventory.roots[0].counts.proofs += 1;
    expect(() =>
      validateLegacyScopeManifest(manifest, inventory, pin, expected),
    ).toThrow('inventory changed');
  });
  it('rejects mapping provenance drift even if the modified artifact is pinned', () => {
    const { manifest, inventory } = fixture();
    manifest.entries[0].producerOrgId = randomUUID();
    expect(() =>
      validateLegacyScopeManifest(
        manifest,
        inventory,
        canonicalSha256(manifest),
        expected,
      ),
    ).toThrow('provenance');
  });
  it('rejects self-review and a manifest for another environment or source', () => {
    const { manifest, inventory } = fixture();
    manifest.reviewerId = manifest.operatorId;
    expect(() =>
      validateLegacyScopeManifest(
        manifest,
        inventory,
        canonicalSha256(manifest),
        expected,
      ),
    ).toThrow('independent review');
    manifest.reviewerId = randomUUID();
    expect(() =>
      validateLegacyScopeManifest(
        manifest,
        inventory,
        canonicalSha256(manifest),
        { ...expected, environment: 'production' },
      ),
    ).toThrow('environment or source');
  });
  it('rejects extra fields and an unresolved entry with a target chain', () => {
    const { manifest, inventory } = fixture();
    expect(() =>
      validateLegacyScopeManifest(
        { ...manifest, token: 'unexpected' },
        inventory,
        canonicalSha256(manifest),
        expected,
      ),
    ).toThrow('unexpected');
    manifest.entries[0].chainId = randomUUID();
    expect(() =>
      validateLegacyScopeManifest(
        manifest,
        inventory,
        canonicalSha256(manifest),
        expected,
      ),
    ).toThrow('mapping decision');
  });
});
