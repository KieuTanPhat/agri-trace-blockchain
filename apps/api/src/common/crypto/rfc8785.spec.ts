import { canonicalSha256 } from './rfc8785.js';

describe('RFC 8785 SHA-256', () => {
  it('produces the same hash regardless of object key order', () => {
    expect(canonicalSha256({ b: 2, a: 1, nested: { z: true, x: null } })).toBe(
      canonicalSha256({ nested: { x: null, z: true }, a: 1, b: 2 }),
    );
  });

  it('matches the SHA-256 digest of canonical JSON', () => {
    expect(canonicalSha256({ a: 1, b: 2 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
  });
});
