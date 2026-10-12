import { isUUID } from 'class-validator';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';

export interface LegacyRootInventory {
  cycleId: string;
  producerOrgId: string;
  version: number;
  active: boolean;
  inventoryDigest: string;
  counts: Record<string, number>;
}

export interface LegacyScopeInventory {
  schema: 'agritrace-legacy-inventory-1';
  roots: LegacyRootInventory[];
  digest: string;
}

export interface LegacyScopeManifest {
  schema:
    'agritrace-legacy-scope-manifest-1' | 'agritrace-legacy-scope-manifest-2';
  id: string;
  sourceSha: string;
  environment: 'isolated' | 'dev';
  inventoryDigest: string;
  operatorId: string;
  reviewerId: string;
  reviewEvidenceDigest: string;
  supersedes?: Array<{
    manifestId: string;
    manifestDigest: string;
    cycleId: string;
  }>;
  entries: Array<{
    cycleId: string;
    producerOrgId: string;
    expectedVersion: number;
    inventoryDigest: string;
    chainId: string | null;
    decision: 'MAP' | 'UNRESOLVED';
  }>;
}

const HASH = /^[a-f0-9]{64}$/;
function fail(reason: string): never {
  throw new Error(`Legacy scope manifest rejected: ${reason}`);
}
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('invalid object');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== keys.sort().join(','))
    fail('unexpected or missing fields');
  return data;
}
function uuid(value: unknown) {
  if (
    typeof value !== 'string' ||
    !isUUID(value) ||
    value !== value.toLowerCase()
  )
    fail('invalid canonical UUID');
}
function hash(value: unknown) {
  if (typeof value !== 'string' || !HASH.test(value)) fail('invalid digest');
}

/** A review artifact, not a source of authority by itself. The caller must
 * supply an independently pinned digest; a digest stored beside DB mappings
 * is insufficient. No target chain is inferred from Farm or shipment parties. */
export function validateLegacyScopeManifest(
  value: unknown,
  inventory: LegacyScopeInventory,
  pinnedDigest: string,
  expected: { environment: 'isolated' | 'dev'; sourceSha: string },
) {
  hash(pinnedDigest);
  const version = (value as { schema?: unknown } | null)?.schema;
  const data = object(value, [
    'schema',
    'id',
    'sourceSha',
    'environment',
    'inventoryDigest',
    'operatorId',
    'reviewerId',
    'reviewEvidenceDigest',
    'entries',
    ...(version === 'agritrace-legacy-scope-manifest-2' ? ['supersedes'] : []),
  ]);
  if (
    ![
      'agritrace-legacy-scope-manifest-1',
      'agritrace-legacy-scope-manifest-2',
    ].includes(String(data.schema))
  )
    fail('schema');
  if (
    data.environment !== expected.environment ||
    data.sourceSha !== expected.sourceSha ||
    typeof data.sourceSha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(data.sourceSha)
  )
    fail('environment or source');
  for (const field of ['id', 'operatorId', 'reviewerId']) uuid(data[field]);
  if (data.operatorId === data.reviewerId) fail('independent review required');
  hash(data.reviewEvidenceDigest);
  hash(data.inventoryDigest);
  if (
    inventory.schema !== 'agritrace-legacy-inventory-1' ||
    inventory.digest !==
      canonicalSha256({ schema: inventory.schema, roots: inventory.roots }) ||
    inventory.digest !== data.inventoryDigest
  )
    fail('inventory changed');
  if (
    !Array.isArray(data.entries) ||
    data.entries.length !== inventory.roots.length
  )
    fail('every legacy root needs a decision');
  const roots = new Map(inventory.roots.map((root) => [root.cycleId, root]));
  if (roots.size !== inventory.roots.length) fail('duplicate inventory root');
  const seen = new Set<string>();
  let lastId = '';
  for (const candidate of data.entries) {
    const entry = object(candidate, [
      'cycleId',
      'producerOrgId',
      'expectedVersion',
      'inventoryDigest',
      'chainId',
      'decision',
    ]);
    uuid(entry.cycleId);
    uuid(entry.producerOrgId);
    hash(entry.inventoryDigest);
    const id = entry.cycleId as string;
    if (seen.has(id) || id <= lastId) fail('duplicate or unsorted root');
    seen.add(id);
    lastId = id;
    const root = roots.get(id);
    if (
      !root ||
      root.producerOrgId !== entry.producerOrgId ||
      !Number.isSafeInteger(entry.expectedVersion) ||
      (entry.expectedVersion as number) < 0 ||
      root.version !== entry.expectedVersion ||
      root.inventoryDigest !== entry.inventoryDigest
    )
      fail('root provenance or version changed');
    if (entry.decision === 'MAP') uuid(entry.chainId);
    else if (entry.decision !== 'UNRESOLVED' || entry.chainId !== null)
      fail('mapping decision');
  }
  if (version === 'agritrace-legacy-scope-manifest-2') {
    if (
      !Array.isArray(data.supersedes) ||
      data.supersedes.length > inventory.roots.length * 100
    )
      fail('invalid supersession list');
    let last = '';
    for (const candidate of data.supersedes) {
      const replacement = object(candidate, [
        'manifestId',
        'manifestDigest',
        'cycleId',
      ]);
      uuid(replacement.manifestId);
      uuid(replacement.cycleId);
      hash(replacement.manifestDigest);
      const key = `${replacement.manifestId}:${replacement.cycleId}`;
      if (
        replacement.manifestId === data.id ||
        !roots.has(String(replacement.cycleId)) ||
        key <= last
      )
        fail('duplicate, unsorted or invalid supersession root');
      last = key;
    }
  }
  if (canonicalSha256(value) !== pinnedDigest)
    fail('independent manifest pin mismatch');
  const manifest = value as LegacyScopeManifest;
  const unresolved = manifest.entries.filter(
    (entry) => entry.decision === 'UNRESOLVED',
  );
  return {
    manifest,
    digest: pinnedDigest,
    mapped: manifest.entries.length - unresolved.length,
    unresolved: unresolved.map((entry) => entry.cycleId),
    activeUnresolved: unresolved
      .filter((entry) => roots.get(entry.cycleId)!.active)
      .map((entry) => entry.cycleId),
  };
}
