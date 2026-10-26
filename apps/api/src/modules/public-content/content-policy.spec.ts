import { randomUUID } from 'node:crypto';
import {
  allowedCover,
  contentCursor,
  contentLimit,
  parseContentCursor,
} from './content-policy.js';
describe('public content policy', () => {
  it('has bounded, endpoint-specific, canonical pagination', () => {
    const id = randomUUID(),
      time = new Date('2026-10-19T00:00:00.000Z');
    const cursor = contentCursor('news', id, time);
    expect(parseContentCursor('news', cursor)).toEqual({ id, time });
    expect(() => parseContentCursor('announcements', cursor)).toThrow();
    for (const value of ['', 'invalid', cursor + '=', 'x'.repeat(257)])
      expect(() => parseContentCursor('news', value)).toThrow();
    for (const limit of [0, 51, 1.5, NaN])
      expect(() => contentLimit(limit)).toThrow();
  });
  it('cover images fail closed without an exact HTTPS hostname allowlist', () => {
    expect(
      allowedCover('https://images.example.test/a.png', 'images.example.test'),
    ).toBe('https://images.example.test/a.png');
    for (const url of [
      'http://images.example.test/a',
      'https://images.example.test.evil/a',
      'https://user:password@images.example.test/a',
      'https://images.example.test:8443/a',
      'data:image/png;base64,abc',
      'bad',
    ])
      expect(allowedCover(url, 'images.example.test')).toBeNull();
    expect(allowedCover('https://images.example.test/a', undefined)).toBeNull();
  });
});
