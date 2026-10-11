import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream, writeFileSync, mkdirSync, mkdtempSync, linkSync, readFileSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';

const [operation, value, archive] = process.argv.slice(2);
const targetEnvironment = process.env.CD_ENVIRONMENT;
if (targetEnvironment && !['development','production'].includes(targetEnvironment)) throw new Error('Unknown CD environment');
const prefix = targetEnvironment === 'development' ? 'dev' : targetEnvironment === 'production' ? 'prod' : 'uat';
const setting = name => targetEnvironment ? process.env[`CD_${name}`] : process.env[`UAT_${name}`];
const temp = path.join(process.env.RUNNER_TEMP, 'agri-cd-ssh');
const key = path.join(temp,'key');
mkdirSync(temp,{recursive:true,mode:0o700});
try {
  assert.ok(typeof setting('SSH_PRIVATE_KEY')==='string'&&setting('SSH_PRIVATE_KEY').trim(),'CD SSH private key is unavailable');
  assert.ok(typeof setting('KNOWN_HOSTS')==='string'&&setting('KNOWN_HOSTS').trim(),'CD SSH host pin is unavailable');
  writeFileSync(key,setting('SSH_PRIVATE_KEY').trim()+'\n',{mode:0o600});
  writeFileSync(path.join(temp,'known_hosts'),setting('KNOWN_HOSTS').trim()+'\n',{mode:0o600});
  assert.ok(['deploy','upgrade','rollback','recover','status','backup'].includes(operation));
  assert.match(setting('HOST'),/^\d{1,3}(?:\.\d{1,3}){3}$/);
  assert.match(setting('USER'),/^[a-z][a-z0-9-]*$/);
  if(targetEnvironment)assert.equal(setting('USER'),`agri-cd-${prefix}`,'SSH identity does not match environment');
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
    '-o','ServerAliveCountMax=4',`${setting('USER')}@${setting('HOST')}`,command],{stdio:['pipe','pipe','inherit']});
  const completion = new Promise((resolve,reject)=>{child.on('error',()=>reject(new Error('SSH could not start')));child.on('close',code=>code===0?resolve():reject(new Error(`CD ${operation} failed (SSH exit ${code}); see server evidence`)));});
  completion.catch(()=>{});
  if(['deploy','upgrade'].includes(operation)){
    child.stdin.write(JSON.stringify(auth)+'\n');
    await pipeline(createReadStream(archive),child.stdin);
  } else child.stdin.end();
  if(operation==='backup'){
    const filename=path.join(process.env.RUNNER_TEMP,`${prefix}-backup-${value}.cms`);
    const download=mkdtempSync(path.join(process.env.RUNNER_TEMP,`${prefix}-backup-download-`));
    const pending=path.join(download,'snapshot.cms');
    try{
      await Promise.all([completion,pipeline(child.stdout,createWriteStream(pending,{mode:0o600,flags:'wx'}))]);
      assert.ok(statSync(pending).size>512,'Encrypted snapshot is incomplete');
      // Publish only complete downloads; exclusive link never replaces or
      // removes a backup saved by an earlier attempt for the same commit.
      linkSync(pending,filename);
    }finally{rmSync(download,{recursive:true,force:true});}
  }else{
    const chunks=[];let size=0;
    for await(const chunk of child.stdout){size+=chunk.length;assert.ok(size<1024*1024,'Unexpected CD output size');chunks.push(chunk);}
    const output=Buffer.concat(chunks).toString('utf8').trim();
    // Controller emits JSON phase records and aggregate evidence only.
    if(output)console.log(output);
    await completion;
  }
} finally {rmSync(temp,{recursive:true,force:true});}
