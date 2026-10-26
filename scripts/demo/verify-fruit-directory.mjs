import assert from 'node:assert/strict';
import {freshProducts,processedProducts} from './fruit-catalog.mjs';
const response=await fetch('http://localhost:8080/api/public/products?limit=50');
assert.equal(response.status,200);
const json=await response.json(),page=json.data??json;
assert.equal(page.items.length,28,'All fresh and processed products with public QR must be discoverable');
const names=new Set(page.items.map(p=>p.productName));
for(const p of [...freshProducts,...processedProducts])assert.ok(names.has(p.name),`Missing ${p.name}`);
for(const p of page.items){
  const response=await fetch(`http://localhost:8080/api/public/products/${p.id}`);
  assert.equal(response.status,200);
  const j=await response.json(),detail=j.data??j;
  assert.ok(detail.lots.items.length>0,`No public QR for ${p.productName}`);
  assert.ok(detail.imageUrl&&Number(detail.price)>0,'Explicitly published product image and indicative price are required');
  assert.ok(!('managerUserId' in detail)&&!('organization' in detail),'Private catalog fields must remain private');
  const image=await fetch(`http://localhost:8080/api${detail.imageUrl}`);
  assert.equal(image.status,200);
  assert.ok(/^image\/(jpeg|png)/.test(image.headers.get('content-type')??''));
  assert.ok((await image.arrayBuffer()).byteLength>100,'Product photo must contain actual image bytes');
}
console.log('PASS 28 public product details, actual images, published prices and QR links, including all three processed products.');
