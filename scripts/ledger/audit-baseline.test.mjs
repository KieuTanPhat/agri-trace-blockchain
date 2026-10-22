import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const hash = (s) => createHash('sha256').update(s).digest('hex');
test('contract metadata resolves hook/command call sites and form endpoints instead of a transport parameter named path',async()=>{
  const {extractContractMetadata}=await import('./audit-baseline.mjs');
  const metadata=extractContractMetadata(`
    function Page(){useWorkspaceData<Member[]>('/enterprise-workspace/members');
      cmd.run('/platform/approvals',{operation,reason},'POST');
      return <DataForm path="/catalog/products" fields={[{name:'sku',label:'FORBIDDEN_LABEL'}]} className="FORBIDDEN_CSS"/>}
    function transport(path){return request(path)}
  `,'page.tsx');
  assert.deepEqual(metadata.requests,[
    {path:'/enterprise-workspace/members',method:'GET',responseType:'Member[]',payloadFields:[]},
    {path:'/platform/approvals',method:'POST',responseType:'unknown',payloadFields:['operation','reason']},
    {path:'/catalog/products',method:'POST',responseType:'unknown',payloadFields:['sku']},
  ]);
  assert.equal(JSON.stringify(metadata).includes('FORBIDDEN'),false);
});
test('baseline contract audit returns endpoints and payload field names with no presentation source', async () => {
  const module=await import('./audit-baseline.mjs');
  assert.equal(typeof module.extractContractMetadata,'function','render-stripped contract audit is missing');
  const result=module.extractContractMetadata(`
    import { request } from '@/lib/api-client';
    async function save(){return request<Product>('/catalog/products',{method:'POST',body:JSON.stringify({sku:code,origin:origin})});}
    export default function Page(){return <div className="FORBIDDEN_CSS"><h1>FORBIDDEN_LABEL</h1><button onClick={save}>FORBIDDEN_BUTTON</button></div>}
  `,'page.tsx');
  assert.deepEqual(result.requests,[{path:'/catalog/products',method:'POST',responseType:'Product',payloadFields:['origin','sku']}]);
  assert.equal(JSON.stringify(result).includes('FORBIDDEN'),false);
});
test('route action audit follows a called headless helper without assigning unrelated endpoints', async(t)=>{
  const repoRoot=mkdtempSync(join(tmpdir(),'ledger-contract-'));t.after(()=>rmSync(repoRoot,{recursive:true,force:true}));
  const put=(p,s)=>{mkdirSync(dirname(join(repoRoot,p)),{recursive:true});writeFileSync(join(repoRoot,p),s);};
  put('apps/web/src/app/members/page.tsx',`import { members } from '@/lib/domain'; export default function Page(){members();return <main className="FORBIDDEN">FORBIDDEN</main>}`);
  put('apps/web/src/lib/domain.ts',`declare function request<T>(p:string,o?:object):Promise<T>; export function members(){return request('/members')} export function unused(){return request('/unrelated')}`);
  const module=await import('./audit-baseline.mjs');
  assert.equal(typeof module.auditRouteContracts,'function','route-specific contract traversal is missing');
  const result=module.auditRouteContracts({repoRoot,routes:[{route:'/members',sourceFile:'apps/web/src/app/members/page.tsx'}]});
  assert.deepEqual(result[0].requests.map(r=>r.path),['/members']);
  assert.equal(JSON.stringify(result).includes('FORBIDDEN'),false);
});
test('preview discovery finds ignored additions, changed and missing inputs without reading secrets or build/test output', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ledger-inputs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (p, s) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s); };
  put('src/app/old/page.tsx', 'changed');
  put('src/app/new/page.tsx', 'new page');
  put('src/components/.ignored-panel.tsx', 'ignored panel');
  put('src/components/.env', 'MUST_NOT_READ');
  put('src/components/keys.env', 'MUST_NOT_READ');
  put('src/components/build/out.tsx', 'build');
  put('src/app/node_modules/untrusted/page.tsx', 'dependency');
  put('src/components/thing.spec.tsx', 'test output');
  put('src/components/__tests__/thing.tsx', 'test fixture');
  put('public/.next/file.js', 'compiled');
  put('src/lib/utils.ts', 'display helper');
  const inventory = { uiSource: {
    discovery: { includeRoots: ['src/app/', 'src/components/', 'public/'], displayHelpers: ['src/lib/utils.ts'] },
    files: [{path: 'src/app/old/page.tsx', sha256: hash('old')}, {path: 'src/components/missing.tsx', sha256: hash('missing')}],
  }};
  const module = await import('./audit-baseline.mjs').catch(() => ({}));
  assert.equal(typeof module.auditPreviewInputs, 'function', 'preview discovery behavior is missing');
  const result = module.auditPreviewInputs({sourceRoot: root, inventory});
  assert.deepEqual(result, {
    added: ['src/app/new/page.tsx', 'src/components/.ignored-panel.tsx', 'src/lib/utils.ts'],
    changed: ['src/app/old/page.tsx'], missing: ['src/components/missing.tsx'],
  });
});
