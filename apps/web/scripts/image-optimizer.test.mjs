import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { getSharp, optimizeImage } = require('next/dist/server/image-optimizer');

for (const [contentType, format] of [
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
]) {
  test(`Next.js optimizes a PNG into ${format} with the patched native sharp`, async () => {
    const sharp = getSharp();
    assert.equal(sharp.versions.sharp, '0.35.5');
    const buffer = await sharp({
      create: { width: 32, height: 16, channels: 3, background: '#369' },
    }).png().toBuffer();
    const optimized = await optimizeImage({ buffer, contentType, quality: 75, width: 16 });
    const metadata = await sharp(optimized).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 16);
    assert.equal(metadata.height, 8);
  });
}
