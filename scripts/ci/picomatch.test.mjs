import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {unresolvedAdvisories} from './picomatch-audit.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {classifyChanges} from './changes.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const mobile='apps/mobile/compat/picomatch-safe';
const chaincode='blockchain/chaincode/src/vendor/picomatch-safe';

test('upstream advisories stay monitored for the private fork',()=>{
  const fixed={url:'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',severity:'high'};
  const future={url:'https://github.com/advisories/GHSA-future',severity:'moderate'};
  assert.deepEqual(unresolvedAdvisories({picomatch:[fixed,future]}),[future]);
  assert.deepEqual(unresolvedAdvisories({}),[]);
  assert.throws(()=>unresolvedAdvisories({error:'offline'}));
  assert.throws(()=>unresolvedAdvisories({message:'registry unavailable'}));
  assert.throws(()=>unresolvedAdvisories({picomatch:{}}));
  assert.throws(()=>unresolvedAdvisories({picomatch:[{url:future.url,severity:'unknown'}]}));
});

test('mobile and independent chaincode carry identical reviewed source',()=>{
  const files=readdirSync(path.join(root,mobile),{recursive:true,withFileTypes:true});
  for(const file of files.filter(f=>f.isFile())) {
    const relative=path.relative(path.join(root,mobile),path.join(file.parentPath,file.name));
    assert.deepEqual(readFileSync(path.join(root,mobile,relative)),readFileSync(path.join(root,chaincode,relative)),relative);
  }
});

test('root consumers resolve the patched matcher rather than upstream picomatch',()=>{
  for(const name of ['vite','tinyglobby']) {
    const require=createRequire(path.join(root,'package.json'));
    const consumer=createRequire(require.resolve(name));
    assert.equal(consumer('picomatch/package.json').name,'@agritrace/picomatch-safe',name);
  }
});

test('matcher patch selects every application and blockchain gate',()=>{
  for(const prefix of [mobile,chaincode]) assert.ok(Object.values(classifyChanges([`${prefix}/lib/parse.js`])).every(Boolean));
});
