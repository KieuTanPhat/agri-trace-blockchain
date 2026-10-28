import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { imageOptimizer } = require('next/dist/server/image-optimizer');
const sharp = require('sharp');

for (const [contentType, format] of [
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp'],
  ['image/avif', 'heif'],
]) {
  test(`Next.js optimizes a PNG into ${format} with the patched native sharp`, async () => {
    assert.equal(sharp.versions.sharp, '0.35.5');
    const buffer = await sharp({
      create: { width: 32, height: 16, channels: 3, background: '#369' },
    }).png().toBuffer();
    const optimized = await imageOptimizer(
      { buffer, contentType: 'image/png', cacheControl: null, etag: 'fixture-upstream' },
      { href: '/fixture.png', width: 16, quality: 75, mimeType: contentType },
      { images: { dangerouslyAllowSVG: false, minimumCacheTTL: 60 }, experimental: {} },
      { silent: true },
    );
    assert.ifError(optimized.error);
    assert.equal(optimized.contentType, contentType);
    const metadata = await sharp(optimized.buffer).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 16);
    assert.equal(metadata.height, 8);
  });
}
