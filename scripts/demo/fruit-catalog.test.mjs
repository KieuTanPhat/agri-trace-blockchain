import assert from 'node:assert/strict';
import test from 'node:test';
import { freshProducts, processedProducts } from './fruit-catalog.mjs';

test('contains exactly 25 distinct fresh fruit and three source-linked processed products', () => {
  assert.equal(freshProducts.length, 25);
  assert.equal(processedProducts.length, 3);
  const all = [...freshProducts, ...processedProducts];
  assert.equal(new Set(all.map(p => p.slug)).size, 28);
  for (const p of all) {
    assert.ok(p.name && p.file && p.price > 0 && p.storage && p.usage && p.variety);
    assert.doesNotMatch(JSON.stringify(p), /demo|mẫu|giả lập/i);
  }
  for (const p of processedProducts) assert.ok(freshProducts.some(f => f.slug === p.source));
  for (const key of ['farm','berry','garden']) assert.ok(freshProducts.filter(p => p.owner === key).length >= 8);
});
