import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const sender=fileURLToPath(new URL('./send.mjs',import.meta.url));
const sha='a'.repeat(40);
function fixture(t){
  const root=mkdtempSync(path.join(os.tmpdir(),'cd transport '));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bin=path.join(root,'bin');mkdirSync(bin);
  const marker=path.join(root,'ssh-called');
  writeFileSync(path.join(bin,'ssh'),`#!/usr/bin/env python3
import hashlib,json,os,stat,sys
from pathlib import Path
Path(os.environ['CD_TEST_MARKER']).write_text('called')
command=sys.argv[-1].split()
if command[0]=='backup':
 sys.stdout.buffer.write(b'incomplete');sys.exit(1)
key=Path(sys.argv[sys.argv.index('-i')+1])
assert stat.S_IMODE(key.stat().st_mode)==0o600
assert stat.S_IMODE(key.parent.stat().st_mode)==0o700
header=sys.stdin.buffer.readline();auth=json.loads(header)
assert auth['username']=='KieuTanPhat' and len(auth['token'])>300
archive=sys.stdin.buffer.read()
assert hashlib.sha256(archive).hexdigest()==command[2]
print(json.dumps({'result':'passed','credentialBytes':len(auth['token']),'archiveBytes':len(archive)}))
`,{mode:0o700});
  const archive=path.join(root,'bundle.tar.gz');writeFileSync(archive,'public bundle fixture');
  const credential='ghs_'+'A'.repeat(1500);
  const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,RUNNER_TEMP:root,
    CD_TEST_MARKER:marker,UAT_HOST:'13.140.170.166',UAT_USER:'agri-cd',
    UAT_SSH_PRIVATE_KEY:'synthetic test key',UAT_KNOWN_HOSTS:'synthetic test host pin',
    REGISTRY_USERNAME:'KieuTanPhat',GH_TOKEN:credential};
  delete env.GITHUB_ACTOR;
  const run=(...args)=>spawnSync(process.execPath,[sender,...args],{env,encoding:'utf8',timeout:10000});
  return {root,archive,credential,env,marker,run};
}

test('transports an opaque long job credential and exact bundle without disclosing it',{skip:process.platform==='win32'},t=>{
  const f=fixture(t);const result=f.run('deploy',sha,f.archive);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{result:'passed',credentialBytes:1504,archiveBytes:21});
  assert.ok(!result.stdout.includes(f.credential)&&!result.stderr.includes(f.credential));
  assert.equal(existsSync(path.join(f.root,'agri-cd-ssh')),false);
});
test('missing registry username fails before SSH and removes temporary key',{skip:process.platform==='win32'},t=>{
  const f=fixture(t);delete f.env.REGISTRY_USERNAME;
  const result=f.run('deploy',sha,f.archive);
  assert.equal(result.status,1);assert.equal(existsSync(f.marker),false);
  assert.equal(existsSync(path.join(f.root,'agri-cd-ssh')),false);
  assert.ok(!result.stderr.includes(f.credential));
});
test('failed backup transport never leaves an incomplete artifact',{skip:process.platform==='win32'},t=>{
  const f=fixture(t);const result=f.run('backup',sha);
  assert.equal(result.status,1);
  assert.equal(existsSync(path.join(f.root,`uat-backup-${sha}.cms`)),false);
  assert.equal(existsSync(path.join(f.root,'agri-cd-ssh')),false);
});

test('missing host pin removes the private key before SSH starts',t=>{
  const f=fixture(t);delete f.env.UAT_KNOWN_HOSTS;
  const result=f.run('deploy',sha,f.archive);
  assert.equal(result.status,1);assert.equal(existsSync(f.marker),false);
  assert.equal(existsSync(path.join(f.root,'agri-cd-ssh')),false);
  assert.ok(!result.stderr.includes(f.env.UAT_SSH_PRIVATE_KEY));
});

test('missing private key leaves no temporary SSH directory',t=>{
  const f=fixture(t);delete f.env.UAT_SSH_PRIVATE_KEY;
  const result=f.run('deploy',sha,f.archive);
  assert.equal(result.status,1);assert.equal(existsSync(f.marker),false);
  assert.equal(existsSync(path.join(f.root,'agri-cd-ssh')),false);
});

test('known-hosts write failure cleans up a key already written',t=>{
  const f=fixture(t);
  mkdirSync(path.join(f.root,'agri-cd-ssh','known_hosts'),{recursive:true});
  const result=f.run('deploy',sha,f.archive);
  assert.equal(result.status,1);assert.equal(existsSync(f.marker),false);
  assert.equal(existsSync(path.join(f.root,'agri-cd-ssh')),false);
  assert.ok(!result.stderr.includes(f.env.UAT_SSH_PRIVATE_KEY));
});
