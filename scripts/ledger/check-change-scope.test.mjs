import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

test('scope gate rejects committed API and untracked DB/Worker/deploy/generated-contract mutations',async(t)=>{
  const repoRoot=mkdtempSync(join(tmpdir(),'ledger-scope-')); t.after(()=>rmSync(repoRoot,{recursive:true,force:true}));
  const git=(...a)=>execFileSync('git',a,{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const put=(p,s)=>{mkdirSync(dirname(join(repoRoot,p)),{recursive:true});writeFileSync(join(repoRoot,p),s);};
  git('init');git('config','user.name','Ledger test');git('config','user.email','ledger@example.invalid');
  put('apps/api/service.ts','baseline');git('add','.');git('commit','-qm','baseline');const baseSha=git('rev-parse','HEAD');
  put('apps/api/service.ts','changed');git('add','.');git('commit','-qm','forbidden');
  for(const p of ['apps/api/prisma/migration.sql','blockchain/worker.ts','deploy/controller.py','apps/web/src/lib/generated/api.d.ts','apps/web/src/features/ledger/ok.ts'])put(p,'change');
  const module=await import('./check-change-scope.mjs').catch(()=>({}));
  assert.equal(typeof module.checkChangeScope,'function','cross-subsystem scope behavior is missing');
  assert.deepEqual(module.checkChangeScope({repoRoot,baseSha}).violations,[
    'apps/api/prisma/migration.sql','apps/api/service.ts','apps/web/src/lib/generated/api.d.ts','blockchain/worker.ts','deploy/controller.py',
  ]);
});
