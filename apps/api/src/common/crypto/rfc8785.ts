import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';

export function canonicalSha256(value: unknown): string {
  const serialized = canonicalize(value);
  if (serialized === undefined)
    throw new TypeError('Value cannot be canonicalized as RFC 8785 JSON');
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
