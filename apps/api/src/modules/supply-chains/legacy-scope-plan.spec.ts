import { randomUUID } from 'node:crypto';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import type { LegacyScopeManifest } from './legacy-scope-manifest.js';
import {
  buildLegacyScopeAssignmentPlan,
  type LegacyPlanningRoot,
} from './legacy-scope-plan.js';

function fixture(sameOrganization = false) {
  const producer = randomUUID();
  const root: LegacyPlanningRoot = {
    id: randomUUID(),
    chainId: null,
    farmOrgId: producer,
    version: 3,
    lots: [0, 1].map(() => {
      const id = randomUUID();
      return {
        id,
        farmOrgId: producer,
        shipment: {
          id: randomUUID(),
          lotId: id,
          transporterOrgId: sameOrganization ? producer : randomUUID(),
          retailerOrgId: sameOrganization ? producer : randomUUID(),
        },
      };
    }),
  };
  const body = {
    schema: 'agritrace-legacy-inventory-1' as const,
    roots: [
      {
        cycleId: root.id,
        producerOrgId: producer,
        version: 3,
        active: true,
        inventoryDigest: 'b'.repeat(64),
        counts: { lots: 2, shipments: 2 },
      },
    ],
  };
  const inventory = { ...body, digest: canonicalSha256(body) };
  const expected = {
    environment: 'isolated' as const,
    sourceSha: 'a'.repeat(40),
  };
  const manifest: LegacyScopeManifest = {
    schema: 'agritrace-legacy-scope-manifest-1',
    id: randomUUID(),
    ...expected,
    inventoryDigest: inventory.digest,
    operatorId: randomUUID(),
    reviewerId: randomUUID(),
    reviewEvidenceDigest: 'c'.repeat(64),
    entries: [
      {
        cycleId: root.id,
        producerOrgId: producer,
        expectedVersion: 3,
        inventoryDigest: 'b'.repeat(64),
        decision: 'MAP',
        chainId: randomUUID(),
      },
    ],
  };
  const pin = canonicalSha256(manifest);
  const build = (roots = [root]) =>
    buildLegacyScopeAssignmentPlan(manifest, inventory, pin, expected, roots);
  return { root, inventory, manifest, pin, expected, build };
}

describe('Read-only legacy assignment proposals', () => {
  it('keeps the production root separate from each Shipment and retail Lot', () => {
    const { root, build } = fixture();
    const result = build();
    expect(result.proposals).toHaveLength(5);
    expect(
      result.proposals.filter((p) => p.stage === 'PRODUCTION'),
    ).toMatchObject([
      {
        organizationId: root.farmOrgId,
        subject: { kind: 'cycle', id: root.id },
      },
    ]);
    for (const lot of root.lots) {
      expect(result.proposals).toContainEqual(
        expect.objectContaining({
          organizationId: lot.shipment!.transporterOrgId,
          stage: 'TRANSPORT',
          subject: { kind: 'shipment', id: lot.shipment!.id },
        }),
      );
      expect(result.proposals).toContainEqual(
        expect.objectContaining({
          organizationId: lot.shipment!.retailerOrgId,
          stage: 'RETAIL',
          subject: { kind: 'lot', id: lot.id },
        }),
      );
    }
    expect(result.applyReady).toBe(false);
    expect(result.cutoverReady).toBe(false);
  });

  it('does not turn same-company stages into accepted or independent party evidence', () => {
    const { root, build } = fixture(true);
    const result = build();
    expect(new Set(result.proposals.map((p) => p.key)).size).toBe(5);
    expect(new Set(result.proposals.map((p) => p.stage)).size).toBe(3);
    expect(
      result.proposals.every(
        (p) =>
          p.organizationId === root.farmOrgId &&
          p.status === 'PROPOSED' &&
          p.requiresParticipantConfirmation,
      ),
    ).toBe(true);
  });

  it('produces the same digest and proposal keys after source ordering changes', () => {
    const { root, build } = fixture();
    const before = build();
    root.lots.reverse();
    expect(build()).toEqual(before);
  });

  it('does not infer a retailer for a Lot without a Shipment', () => {
    const data = fixture();
    data.root.lots[1].shipment = null;
    data.inventory.roots[0].counts.shipments = 1;
    data.inventory.digest = canonicalSha256({
      schema: data.inventory.schema,
      roots: data.inventory.roots,
    });
    data.manifest.inventoryDigest = data.inventory.digest;
    const result = buildLegacyScopeAssignmentPlan(
      data.manifest,
      data.inventory,
      canonicalSha256(data.manifest),
      data.expected,
      [data.root],
    );
    expect(result.proposals).toHaveLength(3);
    expect(
      result.proposals.some((p) => p.subject.id === data.root.lots[1].id),
    ).toBe(false);
  });

  it('keeps unresolved roots explicit and never creates their proposed assignments', () => {
    const data = fixture();
    data.manifest.entries[0].decision = 'UNRESOLVED';
    data.manifest.entries[0].chainId = null;
    const result = buildLegacyScopeAssignmentPlan(
      data.manifest,
      data.inventory,
      canonicalSha256(data.manifest),
      data.expected,
      [],
    );
    expect(result.proposals).toEqual([]);
    expect(result.activeUnresolved).toEqual([data.root.id]);
    expect(result.cutoverReady).toBe(false);
  });

  it('rejects missing, duplicate and unexpected projected roots', () => {
    const { root, build } = fixture();
    expect(() => build([])).toThrow('every mapped root');
    expect(() => build([root, root])).toThrow('every mapped root');
    expect(() => build([{ ...root, id: randomUUID() }])).toThrow('provenance');
  });

  it('rejects root version drift and mapping an already scoped root', () => {
    const { root, build } = fixture();
    expect(() => build([{ ...root, version: root.version + 1 }])).toThrow(
      'provenance',
    );
    expect(() => build([{ ...root, chainId: randomUUID() }])).toThrow(
      'provenance',
    );
  });

  it('rejects omitted child records rather than silently shrinking the proposal', () => {
    const { root, build } = fixture();
    root.lots.pop();
    expect(() => build()).toThrow('child inventory');
  });

  it('rejects a foreign producer, duplicate Lot and wrong Shipment relationship', () => {
    const { root, build } = fixture();
    const original = structuredClone(root.lots);
    root.lots[0].farmOrgId = randomUUID();
    expect(() => build()).toThrow('Lot provenance');
    root.lots = structuredClone(original);
    root.lots[1].id = root.lots[0].id;
    expect(() => build()).toThrow('Lot provenance');
    root.lots = structuredClone(original);
    root.lots[0].shipment!.lotId = randomUUID();
    expect(() => build()).toThrow('Shipment provenance');
  });

  it('rejects changing the reviewed mapping without changing the independent pin', () => {
    const { manifest, build } = fixture();
    manifest.entries[0].chainId = randomUUID();
    expect(() => build()).toThrow('pin mismatch');
  });

  it('rejects a reused Shipment and malformed participant identifier', () => {
    const { root, build } = fixture();
    const original = structuredClone(root.lots);
    root.lots[1].shipment!.id = root.lots[0].shipment!.id;
    expect(() => build()).toThrow('Shipment provenance');
    root.lots = original;
    root.lots[0].shipment!.retailerOrgId = 'unreviewed-party';
    expect(() => build()).toThrow('invalid identifier');
  });

  it('refuses an oversized plan until bounded paging is rehearsed', () => {
    const data = fixture(true);
    data.root.lots = Array.from({ length: 5000 }, () => {
      const id = randomUUID();
      return {
        id,
        farmOrgId: data.root.farmOrgId,
        shipment: {
          id: randomUUID(),
          lotId: id,
          transporterOrgId: data.root.farmOrgId,
          retailerOrgId: data.root.farmOrgId,
        },
      };
    });
    data.inventory.roots[0].counts = { lots: 5000, shipments: 5000 };
    data.inventory.digest = canonicalSha256({
      schema: data.inventory.schema,
      roots: data.inventory.roots,
    });
    data.manifest.inventoryDigest = data.inventory.digest;
    expect(() =>
      buildLegacyScopeAssignmentPlan(
        data.manifest,
        data.inventory,
        canonicalSha256(data.manifest),
        data.expected,
        [data.root],
      ),
    ).toThrow('bounded paging');
  });
});
