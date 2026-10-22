import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const legacy = 'export default function Panel(){return <div>synthetic legacy</div>}\n';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const blob = (s) => createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest('hex');
export function makeUiOriginFixture({legacyImport, via, copiedLegacy, cssFallback, primitive,crlfLegacy} = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ledger-origin-'));
  const put = (p, s) => { mkdirSync(dirname(join(repoRoot,p)), {recursive:true}); writeFileSync(join(repoRoot,p),s); };
  const root = 'apps/web/src/features/ledger/screens/sample/screen.tsx';
  const helper = via ? `apps/web/${via}` : root;
  put(root, via ? `export {default} from '@/lib/helper';` : 'export default function Screen(){return <main>New</main>}');
  if (legacyImport) {
    put(`apps/web/${legacyImport}`, legacy);
    put(helper, `export {default} from '@/${legacyImport.replace(/^src\//,'').replace(/\.tsx$/,'')}';`);
  }
  if(copiedLegacy) put(root,crlfLegacy?legacy.replaceAll('\n','\r\n'):legacy);
  if(cssFallback) { put(root, `import '@/legacy.css'; export default function Screen(){return <main>New</main>}`); put('apps/web/src/legacy.css','body{color:red}'); }
  const files = [];
  const provenance = [];
  if(primitive) { put(root, legacy); files.push({path:'src/components/ui/panel.tsx',sha256:sha256(legacy)}); provenance.push({target:root,source:'src/components/ui/panel.tsx',sourceSha256:sha256(legacy),targetSha256:sha256(legacy)}); }
  const inventory = {uiSource:{files,excludedFromRuntime:['src/lib/mock/']},routes:[{sourceFile:root,targetScreen:root}], legacyUi:[
    {path:'apps/web/src/components/legacy-panel.tsx',gitBlob:blob(legacy)},
    {path:'apps/web/src/legacy.css',gitBlob:blob('body{color:red}')},
  ],provenance};
  put('inventory.json',JSON.stringify(inventory));
  return {repoRoot,inventoryPath:join(repoRoot,'inventory.json')};
}
for (const [name,input,code] of [
  ['indirect re-export into legacy UI', {legacyImport:'src/components/legacy-panel.tsx',via:'src/lib/helper.ts'},'LEGACY_UI_IMPORT'],
  ['renamed unchanged legacy renderer',{copiedLegacy:true},'LEGACY_UI_COPY'],
  ['renamed legacy renderer with Windows line endings',{copiedLegacy:true,crlfLegacy:true},'LEGACY_UI_COPY'],
  ['legacy CSS fallback',{cssFallback:true},'LEGACY_UI_IMPORT'],
]) test(name,async (t)=>{
  const fx=makeUiOriginFixture(input); t.after(()=>rmSync(fx.repoRoot,{recursive:true,force:true}));
  const module=await import('./check-ui-origin.mjs').catch(()=>({}));
  assert.equal(typeof module.checkUiOrigin,'function','UI provenance behavior is missing');
  assert.ok(module.checkUiOrigin({...fx,phase:'final'}).errors.some(e=>e.code===code));
});
test('upstream primitive from approved preview hash with provenance is allowed', async(t)=>{
  const fx=makeUiOriginFixture({primitive:true}); t.after(()=>rmSync(fx.repoRoot,{recursive:true,force:true}));
  const module=await import('./check-ui-origin.mjs').catch(()=>({}));
  assert.equal(typeof module.checkUiOrigin,'function','UI provenance behavior is missing');
  assert.deepEqual(module.checkUiOrigin({...fx,phase:'final'}).errors,[]);
});
test('dynamic import cannot reach preview mock runtime',async(t)=>{
  const fx=makeUiOriginFixture();t.after(()=>rmSync(fx.repoRoot,{recursive:true,force:true}));
  writeFileSync(join(fx.repoRoot,'apps/web/src/features/ledger/screens/sample/screen.tsx'), "export const load=()=>import('@/lib/mock/server');");
  const module=await import('./check-ui-origin.mjs').catch(()=>({}));
  assert.equal(typeof module.checkUiOrigin,'function','UI provenance behavior is missing');
  assert.ok(module.checkUiOrigin({...fx,phase:'final'}).errors.some(e=>e.code==='PREVIEW_RUNTIME_IMPORT'));
});
test('migration phase targets the new namespace, not an unmigrated canonical ledger URL',async(t)=>{
  const fx=makeUiOriginFixture();t.after(()=>rmSync(fx.repoRoot,{recursive:true,force:true}));
  mkdirSync(join(fx.repoRoot,'apps/web/src/app/admin/ledger'),{recursive:true});
  writeFileSync(join(fx.repoRoot,'apps/web/src/app/admin/ledger/page.tsx'),legacy);
  const {checkUiOrigin}=await import('./check-ui-origin.mjs');
  assert.deepEqual(checkUiOrigin({...fx,phase:'migration'}).errors,[]);
  assert.ok(checkUiOrigin({...fx,phase:'final'}).errors.some(e=>e.code==='LEGACY_UI_COPY'));
});
