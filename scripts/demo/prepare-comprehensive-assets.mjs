import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createComprehensiveCatalog, organizationDefinitions } from './comprehensive-catalog.mjs';

const repository=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const inventoryFile=join(repository,'.codex/seed-survey/asset-inventory.json');
const sourceArgument=process.argv.find(a=>a.startsWith('--source='))?.slice('--source='.length);
let inventory;
try{inventory=JSON.parse(await readFile(inventoryFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(sourceArgument&&inventory)assert.equal(resolve(sourceArgument),resolve(inventory.sourceRoot),'Use the original inventory source; never silently replace its hashes');
if(!inventory) {
  assert.ok(sourceArgument,'First import requires --source=<directory containing all five asset folders>');
  inventory={sourceRoot:resolve(sourceArgument),imageCount:0,assets:[]};
  const walk=async(directory,group)=>{
    const entries=await readdir(directory,{withFileTypes:true});entries.sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true}));
    for(const entry of entries){const source=join(directory,entry.name);if(entry.isDirectory()){await walk(source,group);continue;}
      if(!/\.(jpe?g|png|webp|avif)$/i.test(entry.name))continue;
      const bytes=await readFile(source),metadata=await sharp(bytes).metadata();
      inventory.assets.push({source,group,relativePath:source.slice(inventory.sourceRoot.length+1).replaceAll('\\','/'),
        sha256:createHash('sha256').update(bytes).digest('hex'),width:metadata.width,height:metadata.height,bytes:bytes.length});
    }
  };
  for(const group of ['AnhChamSoc','AnhNhaKho','AnhSanPham','GiayCHungNhan','logoDoanhNghiep'])await walk(join(inventory.sourceRoot,group),group);
  inventory.imageCount=inventory.assets.length;assert.equal(inventory.imageCount,316);
  assert.equal(new Set(inventory.assets.map(a=>a.sha256)).size,316,'Source images must be distinct');
  await mkdir(join(repository,'.codex/seed-survey'),{recursive:true});
  await writeFile(inventoryFile,JSON.stringify(inventory,null,2));
}
const directory=join(repository,'.codex/local-fabric/assets');
await mkdir(directory,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const catalog=createComprehensiveCatalog(inventory);
const manifest={protocol:'agritrace-comprehensive-assets/1',sourceRoot:inventory.sourceRoot,assets:[],products:catalog.products};
for(const [i,asset] of inventory.assets.entries()) {
  const original=await readFile(asset.source);assert.equal(sha(original),asset.sha256,'Source image changed since inventory');
  const file=`asset-${String(i+1).padStart(3,'0')}.jpg`;
  const bytes=await sharp(original).rotate().resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:88}).toBuffer();
  assert.ok(bytes.length<5e6);
  await writeFile(join(directory,file),bytes);
  manifest.assets.push({...asset,file,preparedSha256:sha(bytes),preparedBytes:bytes.length});
}
for(const org of organizationDefinitions)assert.equal(manifest.assets.filter(a=>a.group==='logoDoanhNghiep'&&a.relativePath.endsWith(`/${org.logo}`)).length,1);
assert.equal(manifest.assets.length,316);
await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
console.log('Prepared 316 source images, 232 unique products and 20 distinct company logos; originals preserved.');
