import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';

/** Exact nonsecret Docker inputs: detect new and removed files as well as edits. */
export function sourceManifest(repository,name) {
  const paths=['package.json','package-lock.json','.npmrc','.node-version','apps/mobile/compat/minimatch-legacy',
    `apps/${name}`,...(name==='api'?['blockchain/gateway']:[])];
  const listing=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','--',...paths],{cwd:repository,encoding:'utf8'});
  const files=[...new Set(listing.trim().split(/\r?\n/))]
    .filter(path=>path&&!/(^|\/)\.env(?:\.|$)|\.env$|(^|\/)(node_modules|dist|\.next)\//.test(path)).sort();
  const hashes={};for(const path of files)if(existsSync(join(repository,path)))hashes[path]=createHash('sha256').update(readFileSync(join(repository,path))).digest('hex');
  return {digest:createHash('sha256').update(canonicalize(hashes)).digest('hex'),files:hashes};
}
