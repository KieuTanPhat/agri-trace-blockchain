import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream, writeFileSync, mkdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';

const [operation, value, archive] = process.argv.slice(2);
const temp = path.join(process.env.RUNNER_TEMP, 'agri-cd-ssh');
const key = path.join(temp,'key');
mkdirSync(temp,{recursive:true,mode:0o700});
writeFileSync(key,process.env.UAT_SSH_PRIVATE_KEY.trim()+'\n',{mode:0o600});
writeFileSync(path.join(temp,'known_hosts'),process.env.UAT_KNOWN_HOSTS.trim()+'\n',{mode:0o600});
try {
  assert.ok(['deploy','upgrade','rollback','recover','status','backup'].includes(operation));
  assert.match(process.env.UAT_HOST,/^\d{1,3}(?:\.\d{1,3}){3}$/);
  assert.match(process.env.UAT_USER,/^[a-z][a-z0-9-]*$/);
  let command = operation;
  if (!['status','recover'].includes(operation)) {assert.match(value,/^[a-f0-9]{40}$/);command += ` ${value}`;}
  if (['deploy','upgrade'].includes(operation)) {
    command += ` ${createHash('sha256').update(readFileSync(archive)).digest('hex')}`;
    if(operation==='upgrade'){assert.match(process.env.EXPECTED_SEQUENCE,/^[1-9][0-9]{0,8}$/);command+=` ${process.env.EXPECTED_SEQUENCE}`;}
  }
  let auth;
  if(['deploy','upgrade'].includes(operation)){
    auth={username:process.env.REGISTRY_USERNAME ?? process.env.GITHUB_ACTOR,token:process.env.GH_TOKEN};
    assert.ok(typeof auth.username==='string'&&auth.username.length>0,'Registry username is unavailable');
    assert.ok(typeof auth.token==='string'&&auth.token.length>=16,'Registry credential is unavailable');
  }
  const child = spawn('ssh',['-T','-i',key,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',
    '-o',`UserKnownHostsFile=${path.join(temp,'known_hosts')}`,'-o','ConnectTimeout=15','-o','ServerAliveInterval=15',
    '-o','ServerAliveCountMax=4',`${process.env.UAT_USER}@${process.env.UAT_HOST}`,command],{stdio:['pipe','pipe','inherit']});
  const completion = new Promise((resolve,reject)=>{child.on('error',()=>reject(new Error('SSH could not start')));child.on('close',code=>code===0?resolve():reject(new Error(`CD ${operation} failed (SSH exit ${code}); see server evidence`)));});
  completion.catch(()=>{});
  if(['deploy','upgrade'].includes(operation)){
    child.stdin.write(JSON.stringify(auth)+'\n');
    await pipeline(createReadStream(archive),child.stdin);
  } else child.stdin.end();
  if(operation==='backup'){
    const filename=path.join(process.env.RUNNER_TEMP,`uat-backup-${value}.cms`);
    try{
      await Promise.all([completion,pipeline(child.stdout,createWriteStream(filename,{mode:0o600,flags:'wx'}))]);
      assert.ok(statSync(filename).size>512,'Encrypted snapshot is incomplete');
    }catch(error){rmSync(filename,{force:true});throw error;}
  }else{
    const chunks=[];let size=0;
    for await(const chunk of child.stdout){size+=chunk.length;assert.ok(size<1024*1024,'Unexpected CD output size');chunks.push(chunk);}
    const output=Buffer.concat(chunks).toString('utf8').trim();
    // Controller emits JSON phase records and aggregate evidence only.
    if(output)console.log(output);
    await completion;
  }
} finally {rmSync(temp,{recursive:true,force:true});}
