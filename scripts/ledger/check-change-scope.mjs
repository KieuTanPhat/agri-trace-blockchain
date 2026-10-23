import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkChangeScope({repoRoot,baseSha}) {
  const git=(...args)=>execFileSync('git',args,{cwd:repoRoot,encoding:'utf8',maxBuffer:20*1024*1024});
  git('rev-parse','--verify',`${baseSha}^{commit}`);
  const paths=new Set([
    ...git('diff','--name-only','-z',baseSha,'--').split('\0'),
    ...git('ls-files','--others','--exclude-standard','-z').split('\0'),
  ].filter(Boolean));
  const allowed=p=>!p.startsWith('apps/web/src/lib/generated/')&&(
    p.startsWith('apps/web/')||p.startsWith('scripts/ledger/')||p.startsWith('docs/superpowers/')||
    ['package-lock.json','.gitignore','.dockerignore','docs/frontend.md','scripts/ci/hybrid-browser-scenarios.mjs','scripts/ci/enterprise-browser-scenarios.mjs'].includes(p));
  const violations=[...paths].filter(p=>!allowed(p));
  if(paths.has('package-lock.json')) {
    const baseline=JSON.parse(git('show',`${baseSha}:package-lock.json`));
    const current=JSON.parse(readFileSync(resolve(repoRoot,'package-lock.json'),'utf8'));
    // Protected workspace manifests must retain their dependency contract. Hoisting may move shared transitive entries.
    for(const [path,value]of Object.entries(baseline.packages??{}))if(/^(?:apps\/api|blockchain\/[^/]+)$/.test(path)&&JSON.stringify(current.packages?.[path])!==JSON.stringify(value))violations.push(`package-lock.json:${path}`);
  }
  return {violations:violations.sort()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),baseSha=args[args.indexOf('--base')+1];
  const result=checkChangeScope({repoRoot:process.cwd(),baseSha});
  console.log(JSON.stringify(result,null,2));if(result.violations.length)process.exitCode=1;
}
