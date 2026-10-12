import { canonicalSha256 } from '../../common/crypto/rfc8785.js';

export const ROUTE_IMPORT_PROTOCOL = 'agritrace-ledger-route-import/1';
export const WRITER_SNAPSHOT_PROTOCOL = 'agritrace-ledger-writer-snapshot/1';
export type RouteEnvironment = 'production' | 'isolated';
export interface PausedWriterSnapshot {
  protocol: typeof WRITER_SNAPSHOT_PROTOCOL;
  releaseSha: string;
  environment: RouteEnvironment;
  definitionDigest: string;
  paused: true;
}
export interface RouteImportEntry {
  eventId: string;
  dataHash: string;
  eventRowDigest: string;
  snapshotDigest: string;
  definitionDigest: string;
  evidence:
    | { kind: 'PROOF'; digest: string }
    | {
        kind: 'PAUSED_WRITER';
        digest: string;
        descriptor: PausedWriterSnapshot;
      };
}
export interface RouteImportArtifact {
  protocol: typeof ROUTE_IMPORT_PROTOCOL;
  id: string;
  environment: RouteEnvironment;
  sourceSha: string;
  inventoryDigest: string;
  reviewEvidenceDigest: string;
  entries: RouteImportEntry[];
}
export interface RouteImportPin {
  digest: string;
  environment: RouteEnvironment;
  sourceSha: string;
}
export interface RouteImportRecord extends Omit<RouteImportPin, 'environment'> {
  environment: string;
  artifact: unknown;
}

const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid ledger route import metadata');
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  const result = value as Record<string, unknown>;
  requireValue(
    Object.keys(result).sort().join('|') === [...keys].sort().join('|'),
  );
  return result;
}
function hash(value: unknown) {
  requireValue(typeof value === 'string' && HASH.test(value));
}
function environment(value: unknown) {
  requireValue(value === 'production' || value === 'isolated');
}

/** Strict allowlist prevents credentials/private payloads being smuggled into a registry. */
export function validateRouteImportArtifact(
  value: unknown,
): RouteImportArtifact {
  requireValue(Buffer.byteLength(JSON.stringify(value) ?? '') <= 1024 * 1024);
  const artifact = object(value, [
    'protocol',
    'id',
    'environment',
    'sourceSha',
    'inventoryDigest',
    'reviewEvidenceDigest',
    'entries',
  ]);
  requireValue(artifact.protocol === ROUTE_IMPORT_PROTOCOL);
  requireValue(typeof artifact.id === 'string' && UUID.test(artifact.id));
  environment(artifact.environment);
  requireValue(
    typeof artifact.sourceSha === 'string' && SHA.test(artifact.sourceSha),
  );
  hash(artifact.inventoryDigest);
  hash(artifact.reviewEvidenceDigest);
  requireValue(
    Array.isArray(artifact.entries) &&
      artifact.entries.length > 0 &&
      artifact.entries.length <= 1000,
  );
  const ids = new Set<string>();
  for (const value of artifact.entries) {
    const entry = object(value, [
      'eventId',
      'dataHash',
      'eventRowDigest',
      'snapshotDigest',
      'definitionDigest',
      'evidence',
    ]);
    requireValue(
      typeof entry.eventId === 'string' &&
        UUID.test(entry.eventId) &&
        !ids.has(entry.eventId),
    );
    ids.add(entry.eventId);
    for (const field of [
      'dataHash',
      'eventRowDigest',
      'snapshotDigest',
      'definitionDigest',
    ])
      hash(entry[field]);
    requireValue(entry.evidence && typeof entry.evidence === 'object');
    const kind = (entry.evidence as Record<string, unknown>).kind;
    const evidence = object(
      entry.evidence,
      kind === 'PROOF' ? ['kind', 'digest'] : ['kind', 'digest', 'descriptor'],
    );
    hash(evidence.digest);
    requireValue(kind === 'PROOF' || kind === 'PAUSED_WRITER');
    if (kind === 'PAUSED_WRITER') {
      const descriptor = object(evidence.descriptor, [
        'protocol',
        'releaseSha',
        'environment',
        'definitionDigest',
        'paused',
      ]);
      requireValue(
        descriptor.protocol === WRITER_SNAPSHOT_PROTOCOL &&
          descriptor.paused === true,
      );
      requireValue(
        typeof descriptor.releaseSha === 'string' &&
          SHA.test(descriptor.releaseSha),
      );
      requireValue(
        descriptor.environment === artifact.environment &&
          descriptor.definitionDigest === entry.definitionDigest,
      );
      requireValue(canonicalSha256(descriptor) === evidence.digest);
    }
  }
  return value as RouteImportArtifact;
}

export function routeImportPins(
  env: NodeJS.ProcessEnv = process.env,
): RouteImportPin[] {
  const raw = env.LEDGER_ROUTE_IMPORT_PINS;
  if (!raw) return [];
  requireValue(raw.length <= 65536);
  const values: unknown = JSON.parse(raw);
  requireValue(Array.isArray(values) && values.length <= 256);
  const digests = new Set<string>();
  for (const value of values) {
    const pin = object(value, ['digest', 'environment', 'sourceSha']);
    hash(pin.digest);
    environment(pin.environment);
    requireValue(typeof pin.sourceSha === 'string' && SHA.test(pin.sourceSha));
    requireValue(
      env.NODE_ENV !== 'production' || pin.environment === 'production',
    );
    requireValue(!digests.has(pin.digest as string));
    digests.add(pin.digest as string);
  }
  return values as RouteImportPin[];
}

export function pausedWriterPins(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const raw = env.LEDGER_PAUSED_WRITER_PINS;
  if (!raw) return new Set();
  requireValue(raw.length <= 20000);
  const values: unknown = JSON.parse(raw);
  requireValue(Array.isArray(values) && values.length <= 256);
  values.forEach(hash);
  requireValue(new Set(values).size === values.length);
  return new Set(values as string[]);
}

export function verifiedRouteImportArtifact(
  record: RouteImportRecord,
  pins = routeImportPins(),
): RouteImportArtifact {
  const artifact = validateRouteImportArtifact(record.artifact);
  requireValue(canonicalSha256(artifact) === record.digest);
  requireValue(
    record.sourceSha === artifact.sourceSha &&
      record.environment === artifact.environment,
  );
  requireValue(
    pins.some(
      (pin) =>
        pin.digest === record.digest &&
        pin.environment === record.environment &&
        pin.sourceSha === record.sourceSha,
    ),
  );
  const writers = pausedWriterPins();
  requireValue(
    artifact.entries.every(
      (entry) =>
        entry.evidence.kind !== 'PAUSED_WRITER' ||
        writers.has(entry.evidence.digest),
    ),
  );
  return artifact;
}

export function routeImportEntryMatches(
  record: RouteImportRecord,
  event: { id?: string; dataHash: string },
  definitionDigest: string,
): boolean {
  const artifact = verifiedRouteImportArtifact(record);
  return artifact.entries.some(
    (entry) =>
      entry.eventId === event.id &&
      entry.dataHash === event.dataHash &&
      entry.definitionDigest === definitionDigest,
  );
}
