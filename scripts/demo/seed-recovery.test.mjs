import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireSeedLock,ensureSeedAccount,seedContentId} from './seed-recovery.mjs';

test('reconciles dead owners but refuses live operators and orphaned live children',()=>{
 const dir=mkdtempSync(join(tmpdir(),'agritrace-fruit-lock-')),path=join(dir,'operator.lock');
 try{
  writeFileSync(path,JSON.stringify({pid:123}));
  const lock=acquireSeedLock(path,()=>false);lock.update(456);assert.equal(JSON.parse(readFileSync(path,'utf8')).childPid,456);lock.release();
  for(const owner of [{pid:123},{pid:1,childPid:123}]){
   writeFileSync(path,JSON.stringify(owner));assert.throws(()=>acquireSeedLock(path,pid=>pid===123),/still running/);unlinkSync(path);
  }
 }finally{rmdirSync(dir);}
});
test('recovers the same credentials after an account committed but the process failed',async()=>{
 let durable=[],created=null,generations=0;
 const records=[];
 const options={records,key:'+84900000100',generate:()=>({phone:'+84900000100',password:`value-${++generations}`}),persist:async()=>{durable=structuredClone(records);},lookup:async()=>created,create:async r=>{assert.deepEqual(durable,[r]);created={id:'account'};throw new Error('process interrupted after DB commit');}};
 await assert.rejects(ensureSeedAccount(options),/interrupted/);
 const recovered=await ensureSeedAccount({...options,records:durable});
 assert.equal(recovered.password,'value-1');assert.equal(generations,1);
});
test('replaying a partial publication creates exactly six articles and one notice',()=>{
 const ids=new Set();
 for(const count of [3,7])for(let i=0;i<count;i++)ids.add(seedContentId('run-1',`content-${i}`));
 assert.equal(ids.size,7);assert.notEqual(seedContentId('run-1','content-1'),seedContentId('run-2','content-1'));
});
