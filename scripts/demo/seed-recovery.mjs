import {openSync,closeSync,unlinkSync,readFileSync,writeSync,ftruncateSync,fsyncSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';

export function acquireSeedLock(path,alive=(pid)=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}) {
  if(existsSync(path)) {
    let owner;
    try{owner=JSON.parse(readFileSync(path,'utf8'));}catch{throw new Error('Unrecognized operator lock; reconcile running processes before removing it');}
    if([owner.pid,owner.childPid].filter(Boolean).some(alive))throw new Error('Seed operator or its child is still running');
    unlinkSync(path);
  }
  const fd=openSync(path,'wx');
  const update=(childPid)=>{const bytes=Buffer.from(JSON.stringify({pid:process.pid,childPid:childPid??null,at:new Date().toISOString()}));writeSync(fd,bytes,0,bytes.length,0);ftruncateSync(fd,bytes.length);fsyncSync(fd);};
  update();
  return {update,release(){closeSync(fd);unlinkSync(path);}};
}

export function seedContentId(namespace,key) {
  const bytes=createHash('sha256').update(`${namespace}:${key}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export async function ensureSeedAccount({records,key,generate,persist,lookup,create}) {
  let record=records.find(r=>r.phone===key);
  const existing=await lookup();
  if(existing&&!record)throw new Error('Existing seeded identity has no credential checkpoint; reconcile before proceeding');
  if(!record) {
    record=generate();records.push(record);
    await persist(); // Durable credentials precede every account write.
  }
  if(!existing)await create(record);
  return record;
}
