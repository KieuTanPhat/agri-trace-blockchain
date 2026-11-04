// Generation-scoped local dataset. Business history is produced by real API commands.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { hash } from 'bcrypt';
import { canonicalize } from 'json-canonicalize';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { ensurePersonalChain } from '../../apps/api/dist/modules/supply-chains/personal-chain.js';
import { appendPlatformAudit, lockPlatformAudit } from '../../apps/api/dist/modules/platform-governance/platform-audit.js';
import { verifyStoredEvidence } from '../../apps/api/dist/modules/trace/event-evidence.js';
import { generateSignerKey, registrationBody, signPreparedIntent } from '../../apps/api/dist/modules/signing/org-signer.js';
import { organizationDefinitions, createComprehensiveCatalog, cycleAllocations } from './comprehensive-catalog.mjs';
import { classifyRejectedCorrection, executeSavedSignedAction, settlePartnerLink } from './local-fabric-recovery.mjs';
import { createCycleSchedule } from './local-fabric-schedule.mjs';
import { coverOperationalExceptions } from './comprehensive-coverage.mjs';

const repository=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const receiptFile=process.env.AGRITRACE_LOCAL_FABRIC_RECEIPT;
assert.ok(receiptFile,'Use the verified local Fabric operator');
const receipt=JSON.parse(await readFile(receiptFile,'utf8'));
assert.equal(receipt.protocol,'agritrace-local-fabric/1');assert.equal(receipt.production,false);
assert.equal(receipt.backup,null);assert.match(receipt.generation,/^[a-f0-9]{32}$/);
const pilot=process.argv.includes('--pilot');
assert.equal(receipt.mode,pilot?'pilot':'application');
if(!pilot)assert.equal(receipt.destructiveResetCompleted,true);
const runDirectory=process.env.AGRITRACE_LOCAL_FABRIC_RUN;
const assetDirectory=process.env.AGRITRACE_LOCAL_FABRIC_ASSETS;
await mkdir(join(runDirectory,'commands'),{recursive:true});
const manifest=JSON.parse(await readFile(join(assetDirectory,'manifest.json'),'utf8'));
const catalog=createComprehensiveCatalog({assets:manifest.assets});
const base=`http://127.0.0.1:${receipt.apiPort}/api`;
const databaseUrl=new URL(`postgresql://127.0.0.1:${receipt.pgPort}/agri_trace?schema=public`);
databaseUrl.username=process.env.POSTGRES_USER;databaseUrl.password=process.env.POSTGRES_PASSWORD;
const db=new PrismaClient({adapter:new PrismaPg({connectionString:databaseUrl.href})});
const sha=x=>createHash('sha256').update(x).digest('hex');
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
async function save(name,value) {
  const file=join(runDirectory,`${name}.json`);await mkdir(resolve(file,'..'),{recursive:true});
  const temporary=`${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  for(let retry=0;retry<12;retry++) {
    try{await writeFile(temporary,json(value),{mode:0o600});await rename(temporary,file);return;}
    catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||retry===11)throw error;await delay(50*2**Math.min(retry,5));}
  }
}
async function load(name,fallback=null) {try{return JSON.parse(await readFile(join(runDirectory,`${name}.json`),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
const progress=await load('progress',{generation:receipt.generation,T0:new Date().toISOString(),steps:{}});
assert.equal(progress.generation,receipt.generation,'Checkpoint belongs to another database/ledger generation');
await save('progress',progress);
const T0=new Date(progress.T0);
const cycleSchedule=createCycleSchedule(T0,cycleAllocations);
const day=(offset,from=T0)=>new Date(from.getTime()+offset*86400000).toISOString();
const unwrap=x=>x?.record??x;
const roles=['SYSTEM_ADMIN',
  'FARM_STAFF','PROCESSOR','TRANSPORTER','DISTRIBUTOR','RETAILER','ENTERPRISE_STAFF','AUDITOR','CONSUMER'];
const roleOf=type=>type==='FARM'?'FARM_STAFF':type;
// Members below the owner are enterprise employees; inspection bodies keep AUDITOR.
const staffRoleOf=type=>type==='AUDITOR'?'AUDITOR':'ENTERPRISE_STAFF';
const locations=JSON.parse(await readFile(join(repository,'apps/api/src/common/locations/vietnam.json'),'utf8'));
const regionProvinces={BAC:['Hà Nội','Lào Cai','Phú Thọ','Ninh Bình'],TRUNG:['Lâm Đồng','Đắk Lắk','Đà Nẵng','Gia Lai'],NAM:['Đồng Tháp','Cần Thơ','Tây Ninh','An Giang']};
function location(region,index=0) {
  const label=regionProvinces[region][index%regionProvinces[region].length];
  const p=locations.provinces.find(p=>p.label.includes(label))??locations.provinces[index%locations.provinces.length];
  const w=p.wards[index%p.wards.length];return {province:p.label,provinceCode:p.code,ward:w.label,wardCode:w.code};
}
let bootstrap,accounts,actors={};
const sessions=await load('sessions',{});
const tokenFlights=new Map();
async function tokenFor(key) {
  if(sessions[key]?.expiresAt>Date.now()+120000)return sessions[key].token;
  if(tokenFlights.has(key))return tokenFlights.get(key);
  const pending=requestTokenFor(key);tokenFlights.set(key,pending);
  try{return await pending;}finally{tokenFlights.delete(key);}
}
async function requestTokenFor(key) {
  if(sessions[key]?.expiresAt>Date.now()+120000)return sessions[key].token;
  const credential=accounts.users.find(u=>u.key===key);assert.ok(credential,`Missing account ${key}`);
  for(let i=0;i<12;i++) {
    const consumer=credential.role==='CONSUMER';
    const payload=consumer?{phone:'+'+credential.email.split('@')[0],password:credential.password}:{email:credential.email,password:credential.password};
    const r=await fetch(`${base}/auth/${consumer?'mobile/login':'login'}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    if(r.status===429){await r.arrayBuffer();await delay(10000);continue;}
    const value=await r.json();assert.equal(r.status,201,`Login rejected for ${key}`);
    const data=value.data??value;const jwt=JSON.parse(Buffer.from(data.accessToken.split('.')[1],'base64url'));
    sessions[key]={token:data.accessToken,expiresAt:jwt.exp*1000};await save('sessions',sessions);return data.accessToken;
  }
  throw new Error(`Login throttle did not settle for ${key}`);
}
async function readApi(key,route) {
  const r=await fetch(base+route,{headers:key?{Authorization:`Bearer ${await tokenFor(key)}`}:{}});
  const data=await r.json();if(!r.ok)throw new Error(`Read ${route}: HTTP ${r.status} ${json(data.message??data.error).slice(0,500)}`);
  return data.data??data;
}
async function mapConcurrent(items,concurrency,work) {
  let cursor=0,firstError;
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(!firstError&&cursor<items.length){const index=cursor++;try{await work(items[index],index);}catch(error){firstError??=error;}}
  }));
  if(firstError)throw firstError;
}
async function command(key,route,body,label,method='POST') {
  const name=`commands/${sha(label)}`;
  let record=await load(name);
  if(record?.actorKey)assert.equal(record.actorKey,key,'Original actor must be retained for command replay');
  if(record?.complete)return record.result;
  const normalized=JSON.parse(JSON.stringify(body));
  const publicReport=/^\/public\/trace\/[^/]+\/reports$/.test(route);
  if(publicReport&&record)normalized.requestId=record.key;
  if(!record) {record={generation:receipt.generation,label,actorKey:key,requesterId:actors[key].id,route,method,key:publicReport?normalized.requestId:randomUUID(),body:normalized};await save(name,record);}
  assert.equal(record.route,route);assert.equal(record.method,method);
  if(record.lastStatus&&canonicalize(record.body)!==canonicalize(normalized)) {
    const journals=await db.idempotencyRecord.findMany({where:{requesterId:actors[key].id,idempotencyKey:record.key},include:{commandCommit:true}});
    const classification=classifyRejectedCorrection(record,normalized,journals);
    if(['REJECTED_BEFORE_EXECUTION','REJECTED_JOURNAL'].includes(classification)) {
      record.rejectedHistory??=[];record.rejectedHistory.push({body:record.body,key:record.key,status:record.lastStatus,response:record.lastResponse,classification});
      record.body=normalized;if(classification==='REJECTED_JOURNAL')record.key=randomUUID();
      delete record.lastStatus;delete record.lastResponse;await save(name,record);
    }
  }
  // On recovery the current aggregate version/time may differ. The original
  // saved request, never the recomputed body, is the request to replay.
  for(let retry=0;retry<12;retry++) {
    let r;
    try {r=await fetch(base+route,{method,headers:{'content-type':'application/json',Authorization:`Bearer ${await tokenFor(key)}`,'Idempotency-Key':record.key},body:JSON.stringify(record.body)});}
    catch(e){record.lastOutcome='NETWORK_UNKNOWN';await save(name,record);if(retry===11)throw new Error(`Unknown outcome for ${label}; resume original command`);await delay(1500);continue;}
    let value;try{value=await r.json();}catch{value={};}
    if(r.status===429||r.status===503){record.lastOutcome=`HTTP_${r.status}`;await save(name,record);await delay(r.status===429?10000:2000);continue;}
    if(!r.ok) {record.lastStatus=r.status;record.lastResponse=value;await save(name,record);
      throw new Error(`${label}: HTTP ${r.status} ${json(value.message??value.error??value).slice(0,1000)}`);}
    record.complete=true;record.result=value.data??value;record.completedAt=new Date().toISOString();await save(name,record);
    return record.result;
  }
  throw new Error(`Command ${label} not settled; original key and body retained`);
}
async function step(name,work) {
  if(progress.steps[name])return progress.steps[name];
  console.log(`Starting ${name}`);const result=await work();progress.steps[name]=result??true;
  await save('progress',progress);console.log(`Completed ${name}`);return result;
}
function assetFor(source) {
  const asset=manifest.assets.find(a=>a.relativePath===source||a.relativePath.endsWith('/'+source));
  assert.ok(asset,`Asset not found: ${source}`);return asset;
}
const photoGroups=group=>manifest.assets.filter(a=>a.group===group);
async function evidence(key,type,id,kind,source,label,extra={}) {
  const name=`commands/${sha(label)}`;let record=await load(name);if(record?.complete)return record.result;
  const asset=assetFor(source);const bytes=await readFile(join(assetDirectory,asset.file));
  assert.equal(sha(bytes),asset.preparedSha256);
  if(!record){record={generation:receipt.generation,label,key:randomUUID(),assetHash:asset.preparedSha256,type,id,kind,extra};await save(name,record);}
  assert.equal(record.assetHash,asset.preparedSha256);assert.equal(record.id,id);
  const form=new FormData();for(const [k,v] of Object.entries({entityType:type,entityId:id,kind,
    description:extra.description??'Hồ sơ hình ảnh và chứng từ nghiệp vụ',...extra}))form.set(k,String(v));
  form.set('file',new Blob([bytes],{type:'image/jpeg'}),asset.file);
  const r=await fetch(base+'/enterprise-workspace/evidence',{method:'POST',headers:{Authorization:`Bearer ${await tokenFor(key)}`,'Idempotency-Key':record.key},body:form});
  const value=await r.json();if(!r.ok){record.lastStatus=r.status;record.lastResponse=value;await save(name,record);throw new Error(`${label}: HTTP ${r.status} ${json(value.message??value.error??value).slice(0,750)}`);}
  record.complete=true;record.result=value.data??value;await save(name,record);return record.result;
}
async function settled({events=false}={}) {
  for(let i=0;i<360;i++) {
    const [missing,pending,backlog]=await Promise.all([
      db.supplyChain.count({where:{OR:[{ledgerProfile:null},{ledgerProfile:{activeBindingDigest:null}}]}}),
      db.ledgerPermissionSync.count({where:{state:{in:['REQUESTED','PENDING_LEDGER','REVOKE_REQUESTED','PENDING_REVOKE_LEDGER']}}}),
      events?db.blockchainOutbox.count({where:{status:{not:'COMPLETED'}}}):Promise.resolve(0),
    ]);
    if(missing===0&&pending===0&&backlog===0)return;
    if(i%30===0)console.log(`Ledger wait: unbound=${missing}, permissions=${pending}, deliveries=${backlog}`);
    await delay(1000);
  }
  throw new Error('Fabric readiness did not settle; keep generation and inspect Worker');
}

async function initializeBusinessIdentities() {
  const existing=await load('bootstrap');if(existing)return existing;
  let intent=await load('bootstrap-intent');
  if(!intent) {
    assert.equal(await db.user.count(),0,'Fresh-generation database required for bootstrap');
    intent={orgs:{},users:{},accounts:{generation:receipt.generation,users:[]}};
    const add=(key,role,orgKey=null,tier=null)=>{
      const value={id:randomUUID(),key,email:`${key.toLowerCase()}@agritrace.local`,password:`Agri!${randomBytes(18).toString('base64url')}9a`,role,orgKey,tier,
        fullName:['Nguyễn Minh An','Trần Gia Hân','Lê Tuấn Khang','Phạm Ngọc Mai','Võ Khánh Linh','Đặng Hoài Nam','Bùi Thanh Phong','Nguyễn Hoàng Anh'][intent.accounts.users.length%8]};
      intent.users[key]=value;intent.accounts.users.push(value);return value;
    };
    for(const [key,role] of [['admin','SYSTEM_ADMIN'],['operator','SYSTEM_ADMIN'],['cases','SYSTEM_ADMIN'],['privacy','SYSTEM_ADMIN']])add(key,role);
    for(const definition of organizationDefinitions) {
      intent.orgs[definition.key]={...definition,id:randomUUID(),location:location(definition.region,Number(definition.key.slice(1)))};
      add(definition.key,roleOf(definition.type),definition.key,1);
      if(definition.status==='APPROVED') {
        // No manager tier: the operations lead is an employee directly under the owner.
        add(`${definition.key}Manager`,staffRoleOf(definition.type),definition.key,3);
        for(let i=1;i<=2;i++)add(`${definition.key}Staff${i}`,staffRoleOf(definition.type),definition.key,3);
      }
    }
    for(let i=1;i<=16;i++)add(`consumer${i}`,'CONSUMER');
    await save('bootstrap-intent',intent);await save('accounts',intent.accounts);
  }
  const ids=Object.values(intent.users).map(u=>u.id);
  const count=await db.user.count({where:{id:{in:ids}}});
  if(count===ids.length){await save('bootstrap',intent);return intent;}
  assert.equal(count,0,'Partial bootstrap needs reconciliation, not replacement');
  // Consumer identity deliberately uses the reserved phone.invalid mapping
  // enforced by SQL; an email business login must not impersonate this identity.
  for(const user of Object.values(intent.users).filter(u=>u.role==='CONSUMER')) {
    const ordinal=intent.accounts.users.findIndex(u=>u.id===user.id);
    user.email=`8491${String(1000000+ordinal)}@phone.invalid`;
    intent.accounts.users.find(u=>u.id===user.id).email=user.email;
  }
  await save('bootstrap-intent',intent);await save('accounts',intent.accounts);
  const passwordHashes=new Map();for(const user of Object.values(intent.users))passwordHashes.set(user.id,await hash(user.password,10));
  const result=await db.$transaction(async tx=>{
    await lockPlatformAudit(tx);
    for(const code of roles)await tx.role.upsert({where:{code},create:{code,name:code},update:{}});
    const roleRows=await tx.role.findMany();
    for(const definition of Object.values(intent.orgs))await tx.organization.create({data:{id:definition.id,name:definition.name,type:definition.type,
      participationStatus:definition.owner?'CHAIN_OWNER':'MEMBER',status:'ACTIVE'}});
    for(const user of Object.values(intent.users)) {
      const ordinal=intent.accounts.users.findIndex(u=>u.id===user.id);
      const data={id:user.id,email:user.email,fullName:user.fullName,roleId:roleRows.find(r=>r.code===user.role).id,
        passwordHash:passwordHashes.get(user.id),passwordChangedAt:T0,
        phone:`090${String(1000000+ordinal)}`,
        ...(user.orgKey?{organizationId:intent.orgs[user.orgKey].id,enterpriseTier:user.tier,
          memberCode:`NV${String(user.tier===1?1:user.key.endsWith('Manager')?2:user.key.endsWith('1')?3:4).padStart(4,'0')}`,
          jobTitle:user.tier===1?'Giám đốc':user.key.endsWith('Manager')?'Quản lý nghiệp vụ':'Nhân viên nghiệp vụ',
          ...(user.tier>1?{supervisorId:intent.users[user.orgKey].id}:{})}:{}),
        ...(user.role==='CONSUMER'?{loginPhone:`+8491${String(1000000+ordinal)}`,consumerProfile:{create:{
          provinceCode:location('BAC',ordinal).provinceCode,provinceName:location('BAC',ordinal).province,
          wardCode:location('BAC',ordinal).wardCode,wardName:location('BAC',ordinal).ward,
          contactEmail:user.email,businessAddress:'Khu dân cư trung tâm',consentVersion:'DEV-CONSUMER-TEST-20261020'}}}:{})};
      await tx.user.create({data});
    }
    for(const org of Object.values(intent.orgs)) {
      const owner=intent.users[org.key];
      if(org.status!=='APPROVED')await tx.organizationCapability.deleteMany({where:{organizationId:org.id}});
      // AUDITOR is a separate review organization, not one of the five
      // commercial onboarding activities. Never grant FARM to make it fit.
      if(org.type!=='AUDITOR') {
      await tx.enterpriseEnrollment.create({data:{id:randomUUID(),organizationId:org.id,ownerId:owner.id,
        registrationDigest:sha(`local-generation:${receipt.generation}:${org.key}`),businessId:`AGT-${org.key}-2026`,status:org.status,
        ...(org.status==='APPROVED'?{reviewedBy:intent.users.admin.id,reviewNote:'Hồ sơ đã được đối chiếu và phân công vận hành.',
          serviceActivatedAt:T0,serviceActivatedBy:intent.users.admin.id,serviceActivationReason:'Khởi tạo môi trường local theo kế hoạch dữ liệu được chủ dự án chấp thuận.'}:{}),
        ...(org.status==='REJECTED'?{reviewedBy:intent.users.admin.id,reviewNote:'Hồ sơ thiếu tài liệu về cơ sở kinh doanh; cần bổ sung trước khi kích hoạt.'}:{})}});
      await tx.enterpriseProfile.create({data:{organizationId:org.id,legalForm:'ENTERPRISE',...org.location,
        address:`${Number(org.key.slice(1))*12} đường Hòa Bình, ${org.location.ward}, ${org.location.province}`,
        phone:`0287300${String(Number(org.key.slice(1))).padStart(4,'0')}`,contactEmail:owner.email,
        representative:owner.fullName,activities:[org.type],description:`${org.name} quản lý thông tin sản phẩm, cơ sở và hồ sơ giao nhận theo từng lô.`,
        declarationAcceptedAt:T0,legalData:{registrationNumber:`010-${2026000+Number(org.key.slice(1))}`,
          taxCode:`010${String(1000000+Number(org.key.slice(1)))}`,representative:owner.fullName,position:'Giám đốc',issuedAt:'2024-03-12'},
        registrationData:{schemaVersion:2,participationStatus:org.owner?'CHAIN_OWNER':'MEMBER',legalForm:'ENTERPRISE',
          activities:[org.type],termsAccepted:true,privacyAccepted:true,accuracyAccepted:true,marketingAccepted:false,
          acceptedAt:T0.toISOString(),policyVersion:'AGT-2026-10',...(org.type==='FARM'?{production:{type:'CROP',areaM2:96000,annualOutput:120}}:{})}}});
      }
      if(org.status==='APPROVED') {
        await tx.organizationCapability.upsert({where:{organizationId_code:{organizationId:org.id,code:org.type}},create:{organizationId:org.id,code:org.type},update:{}});
        await tx.scopedRoleGrant.create({data:{userId:owner.id,organizationId:org.id,scope:'ORGANIZATION',role:'ORG_ADMIN'}});
        if(org.owner) {
          if(process.env.ENTERPRISE_PAYMENTS_ENABLED==='true') {
          const plan=await tx.servicePlanVersion.findFirstOrThrow({where:{planCode:'OWNER_SCALE',status:'PUBLISHED'},orderBy:{createdAt:'desc'}});
          await tx.subscription.create({data:{organizationId:org.id,planVersionId:plan.id,status:'ACTIVE',startsAt:new Date(day(-30)),endsAt:new Date(day(335))}});
          }
          await tx.scopedRoleGrant.create({data:{userId:owner.id,organizationId:org.id,scope:'ORGANIZATION',role:'CREATE_CHAIN'}});
        }
        if(org.type==='FARM')await ensurePersonalChain(tx,{organizationId:org.id,ownerId:owner.id});
      }
    }
    await appendPlatformAudit(tx,{actor:{sub:intent.users.admin.id,role:'SYSTEM_ADMIN'},action:'PLATFORM_LOCAL_GENERATION_BOOTSTRAP',
      subjectType:'LOCAL_GENERATION',subjectId:receipt.generation,reason:'Khởi tạo danh tính và điều kiện nền cho dữ liệu local đã được ủy quyền.',
      details:{organizations:20,users:94,ledger:'REAL_FABRIC',backup:null}});
    return intent;
  },{timeout:120000});
  await save('bootstrap',result);return result;
}

async function createResources() {
  const result={sites:{},farms:[],plots:[],materials:[],products:[],vehicles:[],profileLogos:{}};
  for(const org of Object.values(bootstrap.orgs)) {
    if(org.status!=='APPROVED')continue;
    if(org.type==='AUDITOR')continue;
    for(let i=0;i<2;i++) {
      const kind=org.type==='PROCESSOR'?'PROCESSING':org.type==='RETAILER'?'RETAIL':i?'COLD_STORAGE':'WAREHOUSE';
      const site=unwrap(await command(org.key,'/enterprise-workspace/sites',{
        name:`${org.name} · ${i?'Khu bảo quản':'Cơ sở tiếp nhận'}`,kind,...{region:org.location.province,ward:org.location.ward},
        address:`${50+i*20} đường Sản Xuất, ${org.location.ward}, ${org.location.province}`,areaM2:800,capacityKg:60000,
        manager:actors[org.key].fullName,representative:actors[org.key].fullName,phone:org.key==='O01'?'0901000001':'0901000002',
        email:actors[org.key].email,staffUserId:actors[org.key].id,otherInfo:'Phân khu tiếp nhận, kiểm đếm và bảo quản theo loại hàng.'},`site:${org.key}:${i}`));
      await evidence(org.key,'SITE',site.id,'SITE_IMAGE',photoGroups('AnhNhaKho')[(Number(org.key.slice(1))+i)%26].relativePath,`site-photo:${site.id}`);
      const complete=unwrap(await command(org.key,`/enterprise-workspace/sites/${site.id}/complete`,{version:site.version},`site-complete:${site.id}`));
      (result.sites[org.key]??=[]).push(complete);
    }
    if(org.type==='TRANSPORTER')for(let i=0;i<(pilot?1:6);i++)result.vehicles.push({
      ...unwrap(await command(org.key,'/enterprise-workspace/vehicles',{registration:`${org.region==='BAC'?'29':org.region==='TRUNG'?'49':'51'}C-${String(21000+Number(org.key.slice(1))*10+i)}`,
        kind:i%2?'Xe tải thùng kín 5 tấn':'Xe tải lạnh 2,5 tấn'},`vehicle:${org.key}:${i}`)),owner:org.key});
  }
  for(const key of ['O01','O08','O16']) {
    for(let i=0;i<(pilot?1:4);i++) {
      const loc=location(['BAC','TRUNG','NAM',bootstrap.orgs[key].region][i],Number(key.slice(1))+i);
      const farm=await command(key,'/catalog/farms',{organizationId:actors[key].organizationId,
        name:`Vùng sản xuất ${bootstrap.orgs[key].name.replace(/^Công ty (Cổ phần )?(Nông nghiệp )?/,'')} · ${loc.province} ${i+1}`,
        kind:'CROP',region:loc.province,address:`Khu canh tác số ${i+1}, ${loc.ward}, ${loc.province}`,areaM2:96000,
        expectedOutput:180000,outputUnit:'kg/năm',privacy:i===3?'PRIVATE':'PUBLIC',
        representative:actors[key].fullName,phone:'0901000001',email:actors[key].email,
        otherInfo:'Vùng sản xuất được chia thửa, có nhật ký chăm sóc và thu hoạch theo đợt.'},`farm:${key}:${i}`);
      await evidence(key,'FARM',farm.id,'LAND_CERTIFICATE',`chungnhandat${i%3+1}.jpg`,`farm-land:${farm.id}`);
      const complete=await command(key,`/catalog/farms/${farm.id}/complete`,{version:farm.version},`farm-complete:${farm.id}`);
      const farmSite=await db.enterpriseSite.findUnique({where:{farmId:farm.id}});
      if(farmSite)await evidence(key,'SITE',farmSite.id,'SITE_IMAGE',photoGroups('AnhChamSoc')[i%29].relativePath,`farm-site-image:${farm.id}`);
      result.farms.push({...complete,owner:key,index:i});
      for(let j=0;j<(pilot?1:4);j++)result.plots.push({...await command(key,'/catalog/plots',{farmId:farm.id,name:`Thửa ${String.fromCharCode(65+j)} · 24.000 m²`,area:24000,unit:'m2',location:'Phân khu canh tác có đường nội bộ và hệ thống tưới.'},`plot:${farm.id}:${j}`),owner:key,farmId:farm.id});
    }
    for(let i=0;i<(pilot?1:15);i++) {
      const kind=i%3===0?'SEED':i%3===1?'FERTILIZER':'PROTECTION';
      const material=unwrap(await command(key,'/enterprise-workspace/materials',{name:`${kind==='SEED'?'Giống canh tác tuyển chọn':kind==='FERTILIZER'?'Phân hữu cơ vi sinh':'Chế phẩm sinh học'} ${Math.floor(i/3)+1}`,
        kind,unit:kind==='SEED'?'g':'kg',code:`${key}-VT-${String(i+1).padStart(3,'0')}`,supplier:'Công ty Vật tư Nông nghiệp Xanh',
        manufacturer:'Cơ sở Vật tư Nông nghiệp',batchCode:`VT-${T0.getFullYear()}-${key}-${i+1}`,origin:'Việt Nam',
        ...(kind==='SEED'?{seedType:'Giống canh tác chọn lọc'}:{}),...(kind==='PROTECTION'?{activeIngredient:'Chế phẩm vi sinh',withdrawalDays:7}:{}),
        expiryDate:day(360).slice(0,10),description:'Vật tư được quản lý theo nhà cung cấp, số lô và hạn dùng.'},`material:${key}:${i}`));
      await evidence(key,'MATERIAL',material.id,kind==='SEED'?'SEED_IMAGE':'MATERIAL_IMAGE',photoGroups('AnhChamSoc')[(i+5)%29].relativePath,`material-photo:${material.id}`);
      result.materials.push({...unwrap(await command(key,`/enterprise-workspace/materials/${material.id}/complete`,{version:material.version},`material-complete:${material.id}`)),owner:key});
    }
  }
  const definitions=pilot?catalog.products.filter(p=>p.cycleIndex!==undefined&&p.cycleIndex<2||p.processed&&(p.number-1)%11===0):catalog.products;
  for(const definition of definitions) {
    const key=definition.owner,actor=actors[key];
    const farm=result.farms.find(f=>f.owner===key);
    const product=await command(key,'/catalog/products',{productName:definition.name,sku:`AGT-${definition.processed?'CB':'NS'}-${String(definition.number).padStart(3,'0')}`,
      variety:definition.name,category:definition.category,defaultUnit:'kg',...(farm?{originFarmId:farm.id}:{}),
      price:definition.processed?55000+definition.number*2500:12000+(definition.number%18)*3500,
      storageConditions:definition.shelfDays>=180?'Bảo quản kín, khô ráo, tránh ánh nắng; kiểm tra tình trạng bao bì và hạn dùng.':'Bảo quản theo điều kiện của từng loại nông sản; kiểm tra độ tươi và tách hàng dập hỏng.',
      usageInstructions:definition.processed?'Sử dụng theo hướng dẫn trên bao bì; kiểm tra hạn dùng trước khi mở.':'Rửa sạch và sơ chế phù hợp trước khi sử dụng.',
      ingredients:definition.processed?`Nguyên liệu chính: ${definition.source?catalog.fresh.find(p=>p.slug===definition.source)?.name??definition.name:'mía'}.`:`100% ${definition.name.toLowerCase()}`,
      rawMaterials:definition.processed?'Nguyên liệu được ghi nhận theo phiếu nhập và mẻ sản xuất.':'Nông sản quản lý theo vùng và đợt thu hoạch.',
      manufacturingSiteId:result.sites[key][0].id,managerUserId:actor.id,
      description:`${definition.name} được quản lý theo mã sản phẩm, nguồn nguyên liệu và hồ sơ lô. Thông tin giao nhận được đối chiếu theo lượng thực nhận.`},`product:${definition.filename}`);
    await evidence(key,'PRODUCT',product.id,'PRODUCT_IMAGE',definition.relativePath,`product-photo:${product.id}`);
    const complete=await command(key,`/catalog/products/${product.id}/complete`,{version:product.version},`product-complete:${product.id}`);
    result.products.push({...complete,owner:key,slug:definition.slug,definition});
  }
  return result;
}

async function createChains(resources) {
  const chains={};
  for(const a of organizationDefinitions.filter(o=>o.status==='APPROVED'&&o.type!=='AUDITOR')) {
    for(const b of organizationDefinitions.filter(o=>o.status==='APPROVED'&&o.type!=='AUDITOR'&&o.key>a.key)) {
      const existing=await db.enterprisePartner.findFirst({where:{OR:[{inviterId:actors[a.key].organizationId,inviteeId:actors[b.key].organizationId},{inviterId:actors[b.key].organizationId,inviteeId:actors[a.key].organizationId}]}});
      await settlePartnerLink(existing,{
        invite:async()=>unwrap(await command(a.key,'/enterprise-workspace/partners',{businessId:`AGT-${b.key}-2026`,note:'Liên kết giao nhận và đối chiếu nguồn lô.'},`partner:${a.key}:${b.key}`)),
        accept:partner=>{
          const receiver=partner.inviteeId===actors[a.key].organizationId?a.key:b.key;
          assert.equal(partner.inviteeId,actors[receiver].organizationId);
          return command(receiver,`/enterprise-workspace/partners/${partner.id}`,{version:partner.version,decision:'ACCEPT'},`partner-accept:${partner.id}`);
        },
      });
    }
  }
  for(const [i,key] of ['O01','O08','O16'].entries())chains[`C0${i+1}`]=await db.supplyChain.findFirstOrThrow({where:{ownerOrganizationId:actors[key].organizationId,personal:true}});
  const participants=['O03','O10','O20','O02','O04','O05','O15','O07','O11','O12','O06','O09','O19'];
  for(const [chainKey,owner] of [['C04','O01'],['C05','O08'],['C06','O06'],['C07','O09'],['C08','O19']]) {
    const chain=await command(owner,'/supply-chains',{name:`${chainKey==='C05'?'Chuỗi giao nhận có chữ ký':chainKey==='C04'?'Chuỗi nông sản và phân phối':'Chuỗi chế biến'} · ${bootstrap.orgs[owner].name}`,
      chainType:bootstrap.orgs[owner].type==='PROCESSOR'?'PROCESSED_FOOD':'CROP',description:'Quản lý sản phẩm, đối tác và bàn giao theo nguồn lô.',
      participants:[{stage:bootstrap.orgs[owner].type,organizationId:actors[owner].organizationId},
        ...participants.filter(k=>k!==owner).map(k=>({stage:bootstrap.orgs[k].type,organizationId:actors[k].organizationId}))],
      productIds:resources.products.filter(p=>p.owner===owner).sort((a,b)=>(a.definition.cycleIndex??999)-(b.definition.cycleIndex??999)).slice(0,50).map(p=>p.id),plannedStartDate:day(-365).slice(0,10)},`chain:${chainKey}`);
    chains[chainKey]=chain;
    for(const other of participants.filter(k=>k!==owner)) {
      const members=await readApi(owner,`/supply-chains/${chain.id}/memberships`);
      const member=members.find(m=>m.organizationId===actors[other].organizationId);
      if(member?.status==='INVITED')await command(other,`/supply-chains/${chain.id}/memberships/${actors[other].organizationId}/accept`,{version:member.version},`membership:${chain.id}:${other}`);
    }
    const profile=await readApi(owner,`/supply-chains/${chain.id}/business-profile`);
    if(profile.state!=='ACTIVE')await command(owner,`/supply-chains/${chain.id}/business-profile/activate`,{version:profile.version},`chain-activate:${chain.id}`);
    for(const auditor of ['O13','O14']) {
      const member=await command(owner,`/supply-chains/${chain.id}/memberships`,{organizationId:actors[auditor].organizationId},`auditor-invite:${chain.id}:${auditor}`);
      await command(auditor,`/supply-chains/${chain.id}/memberships/${actors[auditor].organizationId}/accept`,{version:member.version},`auditor-accept:${chain.id}:${auditor}`);
    }
  }
  return chains;
}

async function grantExecutionRoles(chains) {
  for(const [chainKey,chain] of Object.entries(chains)) {
    const owner=organizationDefinitions.find(d=>bootstrap.orgs[d.key].id===chain.ownerOrganizationId).key;
    const members=await db.chainMembership.findMany({where:{chainId:chain.id,status:'ACTIVE'}});
    for(const member of members) {
      const org=Object.values(bootstrap.orgs).find(o=>o.id===member.organizationId);if(!org)continue;
      const keys=[org.key,`${org.key}Manager`,`${org.key}Staff1`,`${org.key}Staff2`].filter(k=>actors[k]);
      for(const userKey of keys) {
        const role=roleOf(org.type);
        if(await db.scopedRoleGrant.findFirst({where:{userId:actors[userKey].id,chainId:chain.id,role,revokedAt:null}}))continue;
        // Platform authority management grants roles to the actual business
        // identities. No platform account is made a production business actor.
        await command('admin',`/organizations/${org.id}/scoped-grants`,{userId:actors[userKey].id,role,chainId:chain.id},`platform-grant:${chain.id}:${userKey}:${role}`);
      }
    }
    if(!chain.personal)await evidence(owner,'CHAIN',chain.id,'CHAIN_IMAGE',photoGroups('AnhChamSoc')[Number(chainKey.slice(1))%29].relativePath,`chain-image:${chain.id}`);
  }
  await settled();return chains;
}

async function main() {
  for(let i=0;i<90;i++){try{const r=await fetch(base+'/health');if(r.ok)break;}catch{}if(i===89)throw new Error('Local API not ready');await delay(1000);}
  bootstrap=await step('bootstrap',initializeBusinessIdentities);accounts=await load('accounts');
  actors=Object.fromEntries(Object.entries(bootstrap.users).map(([key,user])=>[key,{...user,organizationId:user.orgKey?bootstrap.orgs[user.orgKey].id:null}]));
  const resources=await step('resources',createResources);
  const chains=await step('chains',()=>createChains(resources));
  await settled();
  await continueBusiness({resources,chains});
}

const permissions=['profile.read','profile.manage','members.read','members.manage','roles.manage','partners.read','partners.manage',
  'catalog.read','catalog.manage','sites.read','sites.manage','vehicles.read','vehicles.manage','production.read','production.write',
  'distribution.read','distribution.write','distribution.sign','trace.read','qr.manage','reports.read','quantity.adjust',
  'cases.read','cases.respond','inventory.manage','quarantine.manage','evidence.read','evidence.manage','materials.read','materials.manage','processing.read','processing.write'];

async function configurePeople(resources,chains) {
  const setting=await db.platformSetting.findUnique({where:{key:'billing.farmLedgerLimits'}});
  // This operational limit is intentionally outside the editable UI whitelist.
  // Configure it only inside the already verified local operator generation;
  // keep the normal billing and SQL quota guards fully enabled.
  if(canonicalize(setting?.value??{})!==canonicalize({cycles:40,lots:150}))await db.$transaction(async tx=>{
    await lockPlatformAudit(tx);
    await tx.platformSetting.upsert({where:{key:'billing.farmLedgerLimits'},create:{key:'billing.farmLedgerLimits',value:{cycles:40,lots:150},description:'Hạn mức sổ ghi nông trại trong môi trường local.',updatedBy:actors.admin.id},
      update:{value:{cycles:40,lots:150},version:{increment:1}}});
    await appendPlatformAudit(tx,{actor:{sub:actors.admin.id,role:'SYSTEM_ADMIN'},action:'PLATFORM_LOCAL_FARM_QUOTA_CONFIGURED',
      subjectType:'PLATFORM_SETTING',subjectId:'billing.farmLedgerLimits',reason:'Thiết lập hạn mức local theo kế hoạch 100 vụ; giữ nguyên kiểm tra quota.',details:{cycles:40,lots:150,generation:receipt.generation}});
  });
  // If an earlier preparation reached scoped grants before delegation, drain
  // those grants through the real revoke protocol before changing user scopes.
  // A normal fresh generation assigns delegation first and has none to drain.
  const unconfigured=[];
  for(const user of Object.values(actors).filter(u=>u.orgKey&&u.tier>1&&bootstrap.orgs[u.orgKey].type!=='AUDITOR'))
    if(!await db.enterpriseMemberRole.count({where:{userId:user.id}}))unconfigured.push(user.id);
  const premature=await db.scopedRoleGrant.findMany({where:{userId:{in:unconfigured},revokedAt:null,scope:'CHAIN'}});
  if(premature.length) {
    assert.equal(await db.traceEvent.count(),0,'Do not automatically redelegate actors after business history exists');
    console.log(`Draining ${premature.length} initial grants before delegation.`);
    for(const grant of premature)await command('admin',`/organizations/${grant.organizationId}/scoped-grants/${grant.id}/revoke`,
      {version:grant.revision,chainId:grant.chainId},`initial-delegation-revoke:${grant.id}`);
    await settled();
  }
  for(const org of Object.values(bootstrap.orgs).filter(o=>o.status==='APPROVED'&&o.type!=='AUDITOR')) {
    const chainIds=(await db.chainMembership.findMany({where:{organizationId:org.id,status:'ACTIVE'}})).map(m=>m.chainId);
    const siteIds=[...(resources.sites[org.key]??[]).map(s=>s.id),...resources.farms.filter(f=>f.owner===org.key).map(f=>f.id)];
    for(const tier of ['Manager','Staff']) {
      const role=unwrap(await command(org.key,'/enterprise-workspace/roles',{name:tier==='Manager'?'Quản lý vận hành':'Nhân viên thực hiện',
        permissions:permissions.filter(p=>!['members.manage','roles.manage',...(tier==='Manager'?[]:['profile.manage','partners.manage'])].includes(p))},`enterprise-role:${org.key}:${tier}`));
      for(const userKey of tier==='Manager'?[`${org.key}Manager`]:[`${org.key}Staff1`,`${org.key}Staff2`]) {
        const members=await readApi(org.key,'/enterprise-workspace/members');
        const user=(members.items??members).find(u=>u.id===actors[userKey].id);assert.ok(user);
        await command(org.key,`/enterprise-workspace/members/${user.id}`,{version:user.enterpriseRevision,status:'ACTIVE',roles:[{roleId:role.id,chainIds,siteIds}]},`member-scope:${userKey}`);
      }
    }
  }
  for(const [i,farm] of resources.farms.entries()) {
    const reviewer=i%2?'O14Staff1':'O13Staff1';
    await command('admin','/compliance/assignments',{farmId:farm.id,reviewerUserId:actors[reviewer].id,
      reason:'Phân công người đánh giá độc lập với tổ chức và nhân sự ghi nhận sản xuất.'},`compliance-assignment:${farm.id}`);
  }
  await settled();return true;
}

async function prepareSignedChain(chains) {
  const chain=chains.C05;
  const profile=await db.chainLedgerProfile.findUniqueOrThrow({where:{chainId:chain.id}});
  const keys=await load('c2-keys',{});
  for(const orgKey of ['O08','O03','O10','O20','O07','O11','O12']) {
    if(!keys[orgKey]){keys[orgKey]={...generateSignerKey(),keyRef:randomUUID()};await save('c2-keys',keys);}
    const body=registrationBody(keys[orgKey].privatePem,{bindingDigest:profile.activeBindingDigest,organizationId:actors[orgKey].organizationId,
      label:`Khóa bàn giao ${bootstrap.orgs[orgKey].name}`.slice(0,100),keyRef:keys[orgKey].keyRef});
    await command(orgKey,`/supply-chains/${chain.id}/signing-keys`,body,`c2-register:${orgKey}`);
  }
  for(let i=0;i<240;i++) {
    const active=await db.signingKey.count({where:{keyRef:{in:Object.values(keys).map(k=>k.keyRef)},status:'ACTIVE'}});
    if(active===7)break;if(i===239)throw new Error('Organization signing keys not confirmed on Fabric');await delay(1000);
  }
  execFileSync(process.execPath,['apps/api/dist/operator/ledger-operator.js','set-handover-mode','--chain',chain.id,'--mode','DUAL_SIGNED'],
    {cwd:repository,env:{...process.env,DATABASE_URL:databaseUrl.href},encoding:'utf8',stdio:['ignore','pipe','pipe']});
  return {keys,chainRef:profile.chainRef,bindingDigest:profile.activeBindingDigest};
}

async function recordProduction(resources,chains) {
  const result={cycles:[],lots:[]};let productive=0;
  const jobs=[];
  for(const allocation of cycleAllocations) {
    if(pilot&&!['C04','C05'].includes(allocation.key))continue;
    const desired=pilot?['COMPLETED']:Object.entries(allocation.states).flatMap(([state,n])=>Array(n).fill(state));
    desired.forEach((state,i)=>jobs.push({allocation,state,i}));
  }
  const ordinal=new Map(jobs.filter(j=>['COMPLETED','GROWING'].includes(j.state)).map((j,i)=>[`${j.allocation.key}:${j.i}`,i]));
  const runJob=async({allocation,state,i})=>{
    const chain=chains[allocation.key],key=allocation.owner;
    const own=resources.products.filter(p=>p.owner===key&&!p.definition.processed&&p.definition.cycleIndex!==undefined).sort((a,b)=>a.definition.cycleIndex-b.definition.cycleIndex);
    const offset=allocation.key==='C01'?24:allocation.key==='C02'?23:0;
      const product=own[offset+i];assert.ok(product,`Missing unique product for ${allocation.key}/${i}`);
      const farm=resources.farms.filter(f=>f.owner===key)[allocation.key==='C01'&&i===8?2:i%resources.farms.filter(f=>f.owner===key).length];
      const plots=resources.plots.filter(p=>p.farmId===farm.id);const plot=plots[Math.floor(i/4)%plots.length];
      const yields=['COMPLETED','GROWING'].includes(state);
      const historical=allocation.personal&&state==='COMPLETED';
      const schedule=cycleSchedule[`${allocation.key}:${i}`];
      const plantedAt=schedule.plantedAt;
      const firstHarvest=new Date(Math.min(new Date(day(50,new Date(plantedAt))).getTime(),new Date(day(-8)).getTime())).toISOString();
      const harvestTimes=historical?[firstHarvest,day(3,new Date(firstHarvest)),day(6,new Date(firstHarvest))]:[firstHarvest,day(-4),day(-1)];
      const definition=product.definition;
      const cycle=await command(key,'/production-cycles',{chainId:chain.id,farmId:farm.id,plotId:plot.id,productId:product.id,
        cycleCode:`${allocation.key}-${T0.getFullYear()}-${String(i+1).padStart(3,'0')}`,name:`${product.productName} · ${farm.region??farm.name} · vụ ${i+1}`.slice(0,255),
        startDate:plantedAt.slice(0,10),plannedHarvest:harvestTimes[2].slice(0,10),maxHarvestQuantity:2400,harvestUnit:'kg',cultivatedArea:12000,
        seedMaterialId:resources.materials.find(m=>m.owner===key&&m.kind==='SEED').id,responsibleUserId:actors[key].id,
        cultivationMethod:'Canh tác theo thửa, tưới theo nhu cầu và ghi nhật ký theo đợt.',note:'Quản lý ngày thực hiện, vật tư sử dụng và đối chiếu lượng thu hoạch theo từng lô.'},`cycle:${allocation.key}:${i}`);
      const marker={...cycle,owner:key,chainKey:allocation.key,productSlug:product.slug,farmId:farm.id,desiredState:state};result.cycles.push(marker);
      await command(key,`/production-cycles/${cycle.id}/staff`,{staffUserIds:[actors[key].id,actors[`${key}Manager`].id,actors[`${key}Staff1`].id,actors[`${key}Staff2`].id]},`cycle-team:${cycle.id}`);
      const activity=photoGroups('AnhChamSoc').filter(a=>!/^caylua|^thuhoach|^Lohang/i.test(a.relativePath.split('/').at(-1)));
      await evidence(key,'CYCLE',cycle.id,'CYCLE_IMAGE',activity[i%activity.length].relativePath,`cycle-image:${cycle.id}`);
      if(state==='CREATED')return;
      if(state==='CANCELLED') {
        const current=await db.productionCycle.findUniqueOrThrow({where:{id:cycle.id}});
        await command(key,`/production-cycles/${cycle.id}/cancel`,{version:current.version,reason:'Điều chỉnh kế hoạch sử dụng thửa trước khi triển khai vụ mới.'},`cycle-cancel:${cycle.id}`);return;
      }
      let current=await db.productionCycle.findUniqueOrThrow({where:{id:cycle.id}});
      await command(key,`/production-cycles/${cycle.id}/plant`,{version:current.version,plantedAt},`plant:${cycle.id}`);
      if(state==='PLANTED')return;
      const carePhotos=[];
      for(let j=0;j<(pilot?1:4);j++)carePhotos.push({asset:activity[(i+j)%activity.length],
        evidence:unwrap(await evidence(key,'CYCLE',cycle.id,'CARE_IMAGE',activity[(i+j)%activity.length].relativePath,`care-image:${cycle.id}:${j}`))});
      for(let j=0;j<(pilot?3:25);j++) {
        const photo=carePhotos[j%carePhotos.length];const filename=photo.asset.relativePath.split('/').at(-1).toLowerCase();
        const activityType=filename.includes('tuoi')?'Tưới nước':filename.includes('lamco')?'Làm cỏ':filename.includes('phun')?'Kiểm tra sâu bệnh':'Kiểm tra sinh trưởng';
        const from=new Date(plantedAt).getTime(),until=new Date(harvestTimes[2]).getTime()-3600000;
        const eventTime=new Date(from+(until-from)*(j+1)/26).toISOString();
        current=await db.productionCycle.findUniqueOrThrow({where:{id:cycle.id}});
        await command(key,`/production-cycles/${cycle.id}/care`,{version:current.version,name:`${activityType} · đợt ${j+1}`,careType:activityType,
          eventTime,eventTimeSource:'DEVICE',evidenceRef:photo.evidence.id,performerUserId:actors[`${key}Staff${j%2+1}`].id,
          method:activityType==='Tưới nước'?'Kiểm tra hệ thống tưới và độ ẩm tại thửa.':'Quan sát theo tuyến, ghi nhận tình trạng tại các điểm kiểm tra.',
          cropCondition:j%7===0?'Một số vị trí cần theo dõi bổ sung.':'Sinh trưởng tương đối đồng đều trong phạm vi kiểm tra.',
          note:`Thửa ${plot.name}; đã ghi hình và đối chiếu lịch công việc của đợt ${j+1}.`},`care:${cycle.id}:${j}`);
      }
      const noData=!pilot&&ordinal.get(`${allocation.key}:${i}`)%8===0;
      const device=await command(key,'/iot/devices',{organizationId:actors[key].organizationId,cycleId:cycle.id,
        deviceCode:`${allocation.key}-TD-${String(i+1).padStart(3,'0')}`,name:`Nhiệt độ vùng ${i+1}`,type:'TEMPERATURE'},`device:${cycle.id}`);
      if(!noData)await mapConcurrent(Array.from({length:pilot?6:200},(_,j)=>j),2,async j=>{
        const from=new Date(plantedAt).getTime(),until=new Date(harvestTimes[2]).getTime()-60000;
        const recordedAt=new Date(from+(until-from)*(j+1)/(pilot?7:201)).toISOString();
        await command(key,`/production-cycles/${cycle.id}/sensor-readings`,{deviceId:device.id,sensorType:'TEMPERATURE',value:22+(j%15)*0.45,unit:'°C',recordedAt},`reading:${cycle.id}:${j}`);
      });
      const harvestPhoto=photoGroups('AnhChamSoc').find(a=>a.relativePath.endsWith('thuhoach1.jpg'));
      const harvestEvidence=unwrap(await evidence(key,'CYCLE',cycle.id,'HARVEST_IMAGE',harvestPhoto.relativePath,`harvest-image:${cycle.id}`));
      const lotEvidence=unwrap(await evidence(key,'CYCLE',cycle.id,'LOT_IMAGE',definition.relativePath,`source-lot-image:${cycle.id}`));
      for(let h=0;h<3;h++) {
        current=await db.productionCycle.findUniqueOrThrow({where:{id:cycle.id}});
        const harvest=await command(key,`/production-cycles/${cycle.id}/harvests`,{version:current.version,lotName:`${product.productName} · đợt ${h+1}`,
          representativeUserId:actors[key].id,evidenceRef:harvestEvidence.id,lotImageEvidenceRef:lotEvidence.id,quantity:500+h*50,unit:'kg',harvestTime:harvestTimes[h],
          lotCode:`${allocation.key}-${String(i+1).padStart(3,'0')}-${h+1}`,grade:h===2?'Loại 2':'Loại 1',
          expiryDate:day(definition.shelfDays,new Date(harvestTimes[h])).slice(0,10),packaging:'Thùng thực phẩm có nhãn lô',packageCount:50+h*5,
          harvestArea:'12.000 m²',harvestMethod:'Thu hái, phân loại và kiểm đếm tại vùng sản xuất.',qualityNote:'Đối chiếu ngoại quan, bao gói và lượng thu hoạch.',
          ...(allocation.key==='C04'||allocation.personal?{initialStorageSiteId:resources.sites[key][0].id}:{})},`harvest:${cycle.id}:${h}`);
        result.lots.push({...harvest.lot,owner:key,chainKey:allocation.key,chainId:chain.id,productSlug:product.slug,
          productId:product.id,definition,allocated:allocation.key!=='C05',cycleId:cycle.id});
      }
      if(noData)for(let j=0;j<40;j++)await command(key,`/production-cycles/${cycle.id}/sensor-readings`,{
        deviceId:device.id,sensorType:'TEMPERATURE',value:24+(j%5)*0.25,unit:'°C',recordedAt:day(2+j/100,new Date(plantedAt))},`late-reading:${cycle.id}:${j}`);
      if(state==='COMPLETED') {
        current=await db.productionCycle.findUniqueOrThrow({where:{id:cycle.id}});
        await command(key,`/production-cycles/${cycle.id}/close`,{version:current.version},`close:${cycle.id}`);
      }
      productive++;console.log(`Production: ${productive} productive cycles, ${result.lots.length} harvest lots`);
  };
  // enterpriseAuthority serializes all business writes of one organization.
  // Run one cycle per organization so queued transactions cannot starve their
  // five-second acquisition budget; independent organizations still progress.
  let halted;
  await mapConcurrent(['O01','O08','O16'],3,async owner=>{
    for(const job of jobs.filter(j=>j.allocation.owner===owner)) {
      if(halted)return;
      try{await runJob(job);}catch(error){halted??=error;throw error;}
    }
  });
  return result;
}

async function signedAction(key,route,body,label,context) {
  const saved=await load(`commands/${sha(`${label}:submit`)}`);
  return executeSavedSignedAction(saved,{
    replayOriginal:record=>command(key,record.route,record.body,`${label}:submit`),
    createSubmission:async()=>{
  const prepared=await command(key,route,body,`${label}:prepare`);
  const pair=context.keys[key];
  const entityId=route.includes('/shipments/')?route.split('/')[2]:prepared.intent.entityId;
  const expected={chainRef:context.chainRef,bindingDigest:context.bindingDigest,signerOrgRef:actors[key].organizationId,
    keyRef:pair.keyRef,entityType:'SHIPMENT',entityId,operation:route.includes('confirmation')?'HANDOVER_CONFIRM':'HANDOVER_OFFER'};
  const signed=signPreparedIntent(pair.privatePem,prepared,Date.now(),expected);
  return command(key,`/signing-intents/${prepared.intentId}/submit`,{signature:signed.signature},`${label}:submit`);
    },
  });
}

async function recordShipments(resources,production,context) {
  const result=[];
  for(const [i,lot] of production.lots.filter(l=>l.chainKey==='C05').entries()) {
    if(lot.expiryDate&&new Date(lot.expiryDate).getTime()<new Date(T0.toISOString().slice(0,10)).getTime())continue;
    if(pilot&&result.length>0)break;
    const carrier=['O03','O10','O20'][i%3],retailer=['O07','O11','O12'][i%3];
    const path=`/supply-chains/${lot.chainId}/shipment-plans`;
    const plan=await command(lot.owner,path,{lotId:lot.id,transporterOrgId:actors[carrier].organizationId,retailerOrgId:actors[retailer].organizationId,
      quantity:String(lot.availableQuantity),unit:'kg',origin:bootstrap.orgs[lot.owner].name,destination:bootstrap.orgs[retailer].name,
      vehicleRef:resources.vehicles.find(v=>v.owner===carrier).registration},`shipment-plan:${lot.id}`);
    for(const [party,key]of [['PRODUCER',lot.owner],['TRANSPORTER',carrier],['RETAILER',retailer]])await command(key,`${path}/${plan.id}/accept`,
      {party,revision:plan.currentRevision,payloadDigest:plan.current.payloadDigest},`plan-accept:${plan.id}:${party}`);
    const finalized=await command(lot.owner,`${path}/${plan.id}/finalize`,{version:plan.version},`plan-finalize:${plan.id}`);
    const shipmentId=finalized.shipmentId;assert.ok(shipmentId);
    result.push({id:shipmentId,lotId:lot.id,owner:lot.owner,carrier,retailer});
    const stage=pilot?6:i%7;
    if(stage===0)continue;
    const offered=await signedAction(lot.owner,`/shipments/${shipmentId}/handover-offers/intent`,{
      keyRef:context.keys[lot.owner].keyRef,kind:'PICKUP',offerValidMinutes:10080,signingWindowMinutes:1440},`pickup-offer:${shipmentId}`,context);
    const handoverId=offered.handoverId??offered.id;
    assert.ok(handoverId,'Signed offer must return its handover');
    if(stage===1)continue;
    await signedAction(carrier,`/handovers/${handoverId}/confirmation/intent`,{keyRef:context.keys[carrier].keyRef,signingWindowMinutes:1440},`pickup-confirm:${shipmentId}`,context);
    if(stage===2)continue;
    const arrival=await signedAction(carrier,`/shipments/${shipmentId}/handover-offers/intent`,{
      keyRef:context.keys[carrier].keyRef,kind:'ARRIVAL',offerValidMinutes:10080,signingWindowMinutes:1440},`arrival-offer:${shipmentId}`,context);
    const arrivalId=arrival.handoverId??arrival.id;
    if(stage===3)continue;
    await signedAction(retailer,`/handovers/${arrivalId}/confirmation/intent`,{keyRef:context.keys[retailer].keyRef,signingWindowMinutes:1440},`arrival-confirm:${shipmentId}`,context);
    if(stage===4)continue;
    const row=await db.shipment.findUniqueOrThrow({where:{id:shipmentId}}),current=await db.lot.findUniqueOrThrow({where:{id:lot.id}});
    await command(retailer,`/shipments/${shipmentId}/receive`,{version:row.version,lotVersion:current.version,
      receivedQuantity:Number(current.availableQuantity),damagedQuantity:0,note:'Đã đối chiếu tem nguồn, số lượng và tình trạng bao gói.'},`shipment-receive:${shipmentId}`);
  }
  return result;
}

const distributionKeys=await load('distribution-keys',{});
async function attest(transferId,key,phase) {
  if(!distributionKeys[key]){const pair=generateKeyPairSync('ed25519');distributionKeys[key]={id:randomUUID(),
    publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64url'),privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString()};await save('distribution-keys',distributionKeys);}
  const pair=distributionKeys[key];const keyBody={id:pair.id,organizationId:actors[key].organizationId,publicKey:pair.publicKey};
  await command(key,'/distribution/keys',{id:pair.id,publicKey:pair.publicKey,
    popSignature:sign(null,Buffer.from(`agritrace:distribution-key:1\0${canonicalize(keyBody)}`),pair.privateKey).toString('base64url'),label:`Khóa giao nhận ${key}`},`distribution-key:${key}`);
  const label=`attest:${transferId}:${key}:${phase}`;const saved=await load(`commands/${sha(label)}`);if(saved?.complete)return saved.result;
  let preparation=await load(`prepared/${sha(label)}`);
  if(!preparation) {
    const challenge=await readApi(key,`/distribution/transfers/${transferId}/challenge`);
    const row=await db.distributionTransfer.findUniqueOrThrow({where:{id:transferId}});
    const expiresAt=new Date(Date.now()+15*60000).toISOString();
    const body={snapshotDigest:challenge.snapshotDigest,transferId,phase,organizationId:actors[key].organizationId,userId:actors[key].id,
      keyRef:pair.id,version:String(row.version),expiresAt};
    preparation={version:row.version,phase,keyRef:pair.id,expiresAt,signature:sign(null,Buffer.from(`${challenge.domain}\0${canonicalize(body)}`),pair.privateKey).toString('base64url')};
    await save(`prepared/${sha(label)}`,preparation);
  }
  return command(key,`/distribution/transfers/${transferId}/sign`,preparation,label);
}

async function transfer(resources,lot,sender,receiver,carrier,quantity,label,stage='DELIVERED',senderSite=null) {
  const t=unwrap(await command(sender,'/distribution/transfers',{chainId:lot.chainId,receiverId:actors[receiver].organizationId,carrierId:actors[carrier].organizationId,
    senderSiteId:senderSite??resources.sites[sender][0].id,receiverSiteId:resources.sites[receiver][0].id,carrierSiteId:resources.sites[carrier][0].id,
    vehicleId:resources.vehicles.find(v=>v.owner===carrier).id,origin:bootstrap.orgs[sender].name,destination:resources.sites[receiver][0].address,
    plannedPickupAt:day(1),plannedDeliveryAt:day(2),lines:[{lotId:lot.id,quantity,unit:'kg'}],note:'Đối chiếu mã lô nguồn, lượng giao và chứng từ giữa các bên.'},label));
  if(stage==='PROPOSED')return {...t,lotId:lot.id,sender,receiver,carrier};
  for(const key of [sender,carrier,receiver])await attest(t.id,key,'CONSENT');
  if(stage==='READY')return {...t,lotId:lot.id,sender,receiver,carrier};
  for(const key of [sender,carrier])await attest(t.id,key,'PICKUP');
  if(stage==='IN_TRANSIT')return {...t,lotId:lot.id,sender,receiver,carrier};
  const row=await db.distributionTransfer.findUniqueOrThrow({where:{id:t.id},include:{lines:true}});
  await command(receiver,`/distribution/transfers/${t.id}/receipt`,{version:row.version,
    lines:row.lines.map(l=>({lotId:l.lotId,received:String(l.quantity),rejected:'0',quarantined:'0'})),reason:'Đã kiểm đếm đủ lượng nhận và đối chiếu nhãn nguồn.'},`receipt:${t.id}`);
  for(const key of [carrier,receiver])await attest(t.id,key,'DELIVERY');
  return {...t,lotId:lot.id,sender,receiver,carrier};
}

async function recordDistribution(resources,production) {
  const result=[];const lots=production.lots.filter(l=>l.chainKey==='C04');
  for(const [i,definition]of resources.products.filter(p=>p.definition.processed).entries()) {
    const source=lots.filter(l=>l.productSlug===definition.definition.source&&new Date(l.expiryDate)>=new Date(T0.toISOString().slice(0,10))).at(-1);if(!source)continue;
    const label=`ingredient-transfer:${source.id}:${definition.owner}`;
    if(result.some(t=>t.label===label))continue;
    const t=await transfer(resources,source,source.owner,definition.owner,['O03','O10','O20'][i%3],'100.000',label);
    result.push({...t,label,productSlug:source.productSlug,sourceLotId:source.id,processor:definition.owner});
  }
  if(!pilot)for(const [i,lot]of lots.filter(l=>new Date(l.expiryDate)>=new Date(T0.toISOString().slice(0,10))).entries()) {
    const distributor=['O02','O04','O05','O15'][i%4],carrier=['O03','O10','O20'][i%3];
    const stage=['DELIVERED','DELIVERED','IN_TRANSIT','READY','PROPOSED'][i%5];
    const t=await transfer(resources,lot,lot.owner,distributor,carrier,'100.000',`distribution-first:${lot.id}`,stage);result.push(t);
    if(stage==='DELIVERED') {
      const retailer=['O07','O11','O12'][i%3];
      result.push(await transfer(resources,lot,distributor,retailer,carrier,'40.000',`distribution-second:${lot.id}`,'DELIVERED'));
    }
  }
  return result;
}

async function recordProcessing(resources,chains,distribution) {
  const result=[];
  for(const processor of ['O06','O09','O19']) {
    const products=resources.products.filter(p=>p.owner===processor&&p.definition.processed);
    for(const [p,product]of products.entries()) {
      const definition=product.definition;
      const source=distribution.find(t=>t.processor===processor&&t.productSlug===definition.source);
      const useExternal=!source||definition.number%3===0;
      let receiptRow;
      if(useExternal) {
        const supplier=unwrap(await command(processor,'/enterprise-workspace/partners/external',{businessId:`NCC-${processor}-${product.sku}`,
          name:`Cơ sở Nguyên liệu ${definition.source?catalog.fresh.find(p=>p.slug===definition.source)?.name:'Mía'} ${processor}`,
          kind:'FARM',address:'Khu nguyên liệu tập trung',phone:'0907000001',representative:'Nguyễn Thanh Bình'},`supplier:${product.id}`));
        receiptRow=unwrap(await command(processor,'/processing-runs/receipts',{siteId:resources.sites[processor][0].id,
          materialName:definition.source?catalog.fresh.find(p=>p.slug===definition.source)?.name:'Mía nguyên liệu',supplierId:supplier.id,
          documentNo:`PN-${T0.getFullYear()}-${product.sku}`,receivedAt:day(-1),quantity:'200.000',unit:'kg',expiryDate:day(365).slice(0,10),
          note:'Nhập nguyên liệu theo chứng từ và lưu hồ sơ đối chiếu.'},`external-receipt:${product.id}`));
        await evidence(processor,'MATERIAL_RECEIPT',receiptRow.id,'LAB_TEST','kiemdinhkiemnghiem.jpg',`receipt-document:${receiptRow.id}`);
      }
      const count=pilot?1:p<9?2:1;
      for(let i=0;i<count;i++) {
        const run=unwrap(await command(processor,'/processing-runs',{chainId:chains[{O06:'C06',O09:'C07',O19:'C08'}[processor]].id,
          siteId:resources.sites[processor][0].id,productId:product.id,baseUnit:'kg',
          processType:({GRINDING:'MILLING',JUICING:'JUICE_EXTRACT',DRYING:'DRYING',FERMENTING:'FERMENTING'})[definition.processType]??'OTHER',
          recipe:`Tiếp nhận ${definition.source?catalog.fresh.find(p=>p.slug===definition.source)?.name:'mía'}, sơ chế, xử lý và đóng gói ${definition.name.toLowerCase()}.`,
          inputs:useExternal?[]:[{lotId:source.sourceLotId,quantity:'10.000'}],externalInputs:useExternal?[{receiptId:receiptRow.id,quantity:'10.000'}]:[],
          note:'Đối chiếu nguyên liệu, sản phẩm chính và hao hụt theo mẻ.'},`processing:${product.id}:${i}`));
        const started=unwrap(await command(processor,`/processing-runs/${run.id}/start`,{version:run.version},`processing-start:${run.id}`));
        for(const [j,[stepName,note]]of [['RECEIVING','Đối chiếu phiếu nhập, mã nguyên liệu và số lượng.'],['PRELIMINARY','Làm sạch, phân loại và chuẩn bị nguyên liệu.'],
          ['QUALITY_CHECK','Kiểm tra thông số và cân lượng thành phẩm.'],['PACKING','Đóng gói kín và in định danh lô.']].entries()) {
          const previous=await load(`commands/${sha(`processing-log:${run.id}:${j}`)}`);
          let stamp=await load(`times/${sha(run.id+':'+j)}`);
          // Use the application's database clock: Windows and Docker can be
          // seconds apart, while the service rejects logs before run creation.
          if(!stamp||(!previous?.complete&&previous?.lastStatus===422)) {
            const [clock]=await db.$queryRaw`SELECT clock_timestamp() AS stamp`;
            stamp={value:clock.stamp.toISOString()};await save(`times/${sha(run.id+':'+j)}`,stamp);
          }
          await command(processor,`/processing-runs/${run.id}/logs`,{step:stepName,occurredAt:stamp.value,note},`processing-log:${run.id}:${j}`);
        }
        const output=await command(processor,`/processing-runs/${run.id}/complete`,{version:started.version,
          output:{quantity:'7.000',unit:'kg',lotName:`${definition.name} · mẻ ${i+1}`,packaging:'Bao bì thực phẩm có nhãn mẻ',packageCount:35,expiryDate:day(180).slice(0,10)},
          byProducts:[],losses:[{reason:'OTHER',quantity:'3.000',note:'Phần sơ chế, nước tách và hao hụt đã cân đối.'}]},`processing-complete:${run.id}`);
        result.push({id:run.id,owner:processor,productId:product.id,result:output});
      }
    }
    if(!pilot)for(let i=0;i<5;i++) {
      const product=products[i],source=distribution.find(t=>t.processor===processor&&t.productSlug===product.definition.source);
      const materialName=product.definition.source?catalog.fresh.find(p=>p.slug===product.definition.source)?.name:'Mía nguyên liệu';
      const external=source?null:await db.materialReceipt.findFirstOrThrow({where:{siteId:resources.sites[processor][0].id,materialName,source:'EXTERNAL'}});
      const run=unwrap(await command(processor,'/processing-runs',{chainId:chains[{O06:'C06',O09:'C07',O19:'C08'}[processor]].id,
        siteId:resources.sites[processor][0].id,productId:product.id,baseUnit:'kg',processType:'PRELIMINARY',
        inputs:source?[{lotId:source.sourceLotId,quantity:'2.000'}]:[],externalInputs:external?[{receiptId:external.id,quantity:'2.000'}]:[],recipe:'Chuẩn bị lịch sơ chế và nguồn nguyên liệu.'},`processing-open:${processor}:${i}`));
      if(i>=2)await command(processor,`/processing-runs/${run.id}/start`,{version:run.version},`processing-open-start:${run.id}`);
      if(i===4){const row=await db.processingRun.findUniqueOrThrow({where:{id:run.id}});await command(processor,`/processing-runs/${run.id}/cancel`,
        {version:row.version,reason:'Điều chỉnh kế hoạch cấp nguyên liệu trước khi tiếp tục chế biến.'},`processing-open-cancel:${run.id}`);}
      result.push({id:run.id,owner:processor,productId:product.id});
    }
  }
  return result;
}

async function continueBusiness({resources,chains}) {
  await step('people-and-policy',()=>configurePeople(resources,chains));
  await step('chain-role-grants',()=>grantExecutionRoles(chains));
  const signing=await step('signed-chain',()=>prepareSignedChain(chains));
  const production=await step('production',()=>recordProduction(resources,chains));
  const shipments=await step('shipments',()=>recordShipments(resources,production,signing));
  const distribution=await step('distribution',()=>recordDistribution(resources,production));
  const processing=await step('processing',()=>recordProcessing(resources,chains,distribution));
  await step('additional-modules',()=>additionalModules({resources,chains,production,shipments,distribution,processing}));
  await step('coverage-exceptions',()=>coverOperationalExceptions({db,command,load,save,actors,resources,production,chains,signing,signedAction,attest,transfer,distributionKeys,pilot}));
  if(!pilot)await publishPresentation();
  await settled({events:true});
  const stored=await verifyStoredEvidence(db,{});assert.equal(stored.failed.length,0,'Stored trace evidence verification failed');
  await save(pilot?'pilot-verified':'seeded',{generation:receipt.generation,at:new Date().toISOString(),stored});
  console.log(pilot?'Pilot API/Worker/Fabric completed.':'Dataset commands completed; proceed to independent DB/ledger/QR/browser verification.');
}

async function additionalModules({resources,production,shipments,distribution}) {
  if(pilot)return true;
  // Profile media are part of the private operator identity import. Include
  // inactive enrollment owners and AUDITOR identities without inventing write
  // capabilities for them. All trace-bearing business commands above use HTTP.
  for(const org of Object.values(bootstrap.orgs)) {
    const asset=assetFor(org.logo),bytes=await readFile(join(assetDirectory,asset.file));
    if(!await db.traceEvidence.findFirst({where:{organizationId:org.id,entityType:'PROFILE',entityId:org.id,fileName:`logo-${org.key}.jpg`}})) {
      await db.$transaction(async tx=>{await lockPlatformAudit(tx);
        await tx.traceEvidence.create({data:{organizationId:org.id,entityType:'PROFILE',entityId:org.id,fileName:`logo-${org.key}.jpg`,
          mediaType:'image/jpeg',size:bytes.length,sha256:sha(bytes),content:bytes,description:`Logo ${org.name}`,kind:'OTHER',actorId:actors[org.key].id}});
        await appendPlatformAudit(tx,{actor:{sub:actors.admin.id,role:'SYSTEM_ADMIN'},action:'PLATFORM_LOCAL_PROFILE_MEDIA_IMPORT',
          subjectType:'ORGANIZATION',subjectId:org.id,organizationId:org.id,reason:'Nhập ảnh nhận diện từ bộ tài nguyên do chủ dự án cung cấp.',details:{sourceSha256:asset.sha256}});
      });
    }
    if(org.status==='APPROVED'&&org.type!=='AUDITOR') {
      await evidence(org.key,'PROFILE',org.id,'BUSINESS_LICENSE',Number(org.key.slice(1))%2?'giaycndkidoanhnghiep01.jpg':'giaycndkidoanhnghiep02.jpg',`profile-registration:${org.id}`);
      if(org.type==='PROCESSOR')await evidence(org.key,'PROFILE',org.id,'CERTIFICATE_IMAGE','giaychungnhanattthuypham.jpg',`profile-food-safety:${org.id}`);
    }
  }
  await evidence('O01','MEMBER',actors.O01.id,'MEMBER_DOCUMENT','giayuyquyen.webp','profile-authorization');
  await evidence('O01','CHAIN',progress.steps.chains.C04.id,'OTHER','hopdonglienketmuaban.jpg','chain-production-contract');
  for(const product of resources.products) {
    // Brand approval is a chain-owner workflow; the free FARM member keeps its
    // own catalog and traceable lots without being promoted to chain owner.
    if(!bootstrap.orgs[product.owner].owner)continue;
    await evidence(product.owner,'PRODUCT',product.id,'PRODUCT_DECLARATION','kiemdinhkiemnghiem.jpg',`product-declaration:${product.id}`);
    let row=await db.product.findUniqueOrThrow({where:{id:product.id}});
    if(['NONE','REJECTED'].includes(row.approvalStatus))await command(product.owner,`/catalog/products/${product.id}/approval-request`,{version:row.version},`product-approval-request:${product.id}`);
    row=await db.product.findUniqueOrThrow({where:{id:product.id}});
    await command('admin',`/platform-admin/product-approvals/${product.id}/review`,{version:row.version,decision:'APPROVE',note:'Đã đối chiếu ảnh, mô tả, đơn vị và hồ sơ chủ sở hữu sản phẩm.'},`product-approval:${product.id}`);
  }

  const eligible=production.cycles.filter(c=>['C04','C05'].includes(c.chainKey));
  for(const [i,cycle]of eligible.slice(0,12).entries()) {
    const assignment=await db.complianceAssignment.findFirstOrThrow({where:{farmId:cycle.farmId,revokedAt:null}});
    const reviewer=Object.keys(actors).find(k=>actors[k].id===assignment.reviewerUserId);
    const document=unwrap(await evidence(cycle.owner,'CYCLE',cycle.id,'CERTIFICATE_IMAGE','kiemdinhkiemnghiem.jpg',`certificate-document:${cycle.id}`));
    const certificate=await command(cycle.owner,'/certificates',{cycleId:cycle.id,type:'Hồ sơ kiểm soát vùng sản xuất',
      issuer:bootstrap.orgs[actors[reviewer].orgKey].name,issueDate:day(-5).slice(0,10),expiryDate:day(180).slice(0,10),isPublic:false,
      documentRef:`/enterprise-workspace/evidence/${document.id}/file`,documentHash:document.sha256},`certificate:${cycle.id}`);
    if(i%3!==2)await command(reviewer,`/certificates/${certificate.id}/review`,{version:certificate.version,status:i%3===0?'APPROVED':'REJECTED',
      reviewNote:i%3===0?'Đã đối chiếu hồ sơ, thời hạn và phạm vi vùng sản xuất.':'Cần bổ sung nội dung kiểm tra trước khi chấp thuận hồ sơ.'},`certificate-review:${cycle.id}`,'PATCH');
  }
  for(const [i,lot]of production.lots.filter(l=>['C04','C05'].includes(l.chainKey)).filter((_,i)=>i%4===0).entries()) {
    const cycle=production.cycles.find(c=>c.id===lot.cycleId);
    const assignment=await db.complianceAssignment.findFirstOrThrow({where:{farmId:cycle.farmId,revokedAt:null}});
    const reviewer=Object.keys(actors).find(k=>actors[k].id===assignment.reviewerUserId);
    await command(reviewer,'/inspections',{lotId:lot.id,result:i%11===0?'CONDITIONAL':'PASS',inspectedAt:day(-0.1),
      note:i%11===0?'Theo dõi thêm tình trạng bao gói trong thời gian bảo quản.':'Đã đối chiếu mã lô, số lượng và hồ sơ kiểm tra.'},`inspection:${lot.id}`);
  }
  for(const [i,t]of distribution.filter(t=>['O07','O11','O12'].includes(t.receiver)).entries()) {
    if(i>=18)break;
    const lot=await db.lot.findUniqueOrThrow({where:{id:t.lotId}});
    await command(t.receiver,'/distribution/quantities',{lotId:lot.id,quantity:'10.000',unit:'kg',version:lot.version,kind:'SALE',
      siteId:resources.sites[t.receiver][0].id,reason:'Xuất bán tại cửa hàng sau khi đã đối chiếu lô và lượng thực nhận.'},`retail-sale:${t.id}`);
  }
  const sourceLots=production.lots.filter(l=>l.chainKey==='C04');
  for(const [i,lot]of sourceLots.slice(-3).entries()) {
    await command(lot.owner,'/distribution/notices',{lotId:lot.id,kind:i===0?'RECALL':'WARNING',
      message:i===0?'Tạm dừng lưu thông lô để đối chiếu điều kiện bảo quản; liên hệ đơn vị cung ứng theo thông tin trên nhãn.':'Theo dõi tình trạng bao bì và đối chiếu thông tin lô trước khi nhận hàng.'},`trace-notice:${lot.id}`);
  }
  const expired=production.lots.filter(l=>l.chainKey==='C05'&&l.expiryDate&&new Date(l.expiryDate).getTime()<new Date(T0.toISOString().slice(0,10)).getTime());
  for(const lot of expired) {
    const current=await db.lot.findUniqueOrThrow({where:{id:lot.id}});
    await command(lot.owner,`/lots/${lot.id}/expire`,{version:current.version,reason:'Lô đã qua hạn dùng được ghi nhận trên hồ sơ thu hoạch.'},`expire:${lot.id}`);
  }
  for(const [i,shipment]of shipments.filter((_,i)=>i%7===5).slice(0,8).entries()) {
    const lot=await db.lot.findUniqueOrThrow({where:{id:shipment.lotId}}),row=await db.shipment.findUniqueOrThrow({where:{id:shipment.id}});
    if(lot.currentState==='RETAIL_RECEIVED')await command(shipment.retailer,`/lots/${lot.id}/mark-for-sale`,{version:lot.version,shipmentVersion:row.version},`mark-for-sale:${lot.id}`);
  }

  for(const [i,key]of ['O01','O08','O07'].entries())await command(key,'/privacy-requests',{
    requestType:['ACCESS','CORRECTION','RESTRICTION'][i],message:'Đề nghị đối chiếu thông tin hồ sơ và phạm vi chia sẻ dữ liệu tại các cơ sở được phân công.'},`privacy-request:${key}`);
  await command('privacy','/platform-privacy/breaches',{detectedAt:day(-0.1),message:'Diễn tập tiếp nhận và phân loại hồ sơ bảo vệ dữ liệu trong môi trường local.'},'privacy-exercise');
  for(let i=0;i<3;i++) {
    await command('admin','/platform-admin/notices',{title:['Hướng dẫn đối chiếu thông tin lô','Lịch kiểm tra hệ thống tưới','Kiểm tra bao gói khi tiếp nhận'][i],
      body:['Quét mã trên nhãn để đối chiếu nguồn lô, lịch sử giao nhận và cảnh báo đang có hiệu lực.','Đội ngũ vùng sản xuất kiểm tra lịch chăm sóc và các thiết bị đang được phân công.','Đối chiếu số lượng, tình trạng hàng và nhãn lô trước khi xác nhận nhận hàng.'][i],
      audience:i?'ENTERPRISE':'ALL',severity:i===1?'WARNING':'INFO',startsAt:day(-1),endsAt:day(30)},`system-notice:${i}`);
    await command('cases','/platform-cases',{title:`Đối soát hồ sơ lô ${i+1}`,description:'Tiếp nhận phản ánh và phân công đối chiếu thông tin liên quan đến nhãn, chất lượng hoặc điều kiện bảo quản.',
      category:['QUALITY','LABELING','OTHER'][i],severity:['LOW','MEDIUM','HIGH'][i],source:'INTERNAL',lotId:sourceLots[i].id,responseDueAt:day(3)},`platform-case:${i}`);
  }
  for(const [i,title]of ['Đối chiếu nhãn lô trước khi nhận hàng','Bảo quản nông sản theo từng nhóm sản phẩm','Đọc lịch sử truy xuất và cảnh báo','Theo dõi nguyên liệu trong lô chế biến','Nhật ký vùng trồng và thông tin người tiêu dùng','Phân biệt ngày thu hoạch và hạn sử dụng'].entries()) {
    const id=sha(`news:${receipt.generation}:${i}`).slice(0,32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
    await db.consumerNews.upsert({where:{id},update:{},create:{id,title,summary:'Thông tin hướng dẫn đối chiếu hồ sơ sản phẩm và lựa chọn điều kiện bảo quản phù hợp.',
      body:'Quét mã trên nhãn để kiểm tra tên sản phẩm, đơn vị cung ứng, thời điểm thu hoạch và các cảnh báo. Đối chiếu số lượng khi nhận hàng; giữ bao bì và mã lô để thuận tiện tra cứu khi cần.',isPublished:true,publishedAt:new Date(day(-i*20-1))}});
  }
  for(const lot of await db.lot.findMany()) {
    const product=resources.products.find(p=>p.id===lot.productId);assert.ok(product);
    await evidence(product.owner,'LOT',lot.id,'LOT_IMAGE',product.definition.relativePath,`public-lot-image:${lot.id}`,{public:true,publicationConfirmed:true,description:`Hình ảnh ${product.productName} theo mã sản phẩm.`});
  }
  await publishPresentation();
  return true;
}

async function publishPresentation() {
  const [profiles,sites,lots,images,lines,shipments]=await Promise.all([
    db.enterpriseProfile.findMany(),db.enterpriseSite.findMany({where:{status:'ACTIVE'}}),
    db.lot.findMany({include:{harvest:{include:{cycle:{include:{farm:true}}}},processingRun:true}}),
    db.traceEvidence.findMany({where:{withdrawal:null},select:{id:true,organizationId:true,entityType:true,entityId:true,kind:true,fileName:true,public:true}}),
    db.distributionLine.findMany({include:{transfer:true}}),db.shipment.findMany(),
  ]);
  for(const profile of profiles) {
    const org=Object.values(bootstrap.orgs).find(o=>o.id===profile.organizationId);if(org?.status!=='APPROVED')continue;
    const logo=images.find(e=>e.organizationId===org.id&&e.fileName===`logo-${org.key}.jpg`);assert.ok(logo);
    const traceMedia=[];
    const add=(lot,image,groupKey,caption)=>{if(image&&!traceMedia.some(m=>m.lotId===lot.id&&m.evidenceId===image.id&&m.groupKey===groupKey))traceMedia.push({lotId:lot.id,evidenceId:image.id,groupKey,caption});};
    for(const lot of lots) {
      const owned=lot.farmOrgId===org.id,cycle=lot.harvest?.cycle;
      const farmSite=cycle?sites.find(s=>s.farmId===cycle.farmId):null;
      const siteIds=new Set();
      if(owned) {
        const group=lot.processingRun?`site:${lot.processingRun.siteId}`:lot.initialStorageSiteId?`site:${lot.initialStorageSiteId}`:farmSite?`site:${farmSite.id}`:`org:${org.id}`;
        add(lot,images.find(e=>e.entityType==='LOT'&&e.entityId===lot.id&&e.kind==='LOT_IMAGE'&&e.public),group,'Hình ảnh sản phẩm theo mã lô');
        for(const site of [lot.initialStorageSiteId,lot.processingRun?.siteId])if(site)siteIds.add(site);
        if(cycle?.farm.privacy==='PUBLIC') {
          if(farmSite)siteIds.add(farmSite.id);
          for(const kind of ['CYCLE_IMAGE','CARE_IMAGE','HARVEST_IMAGE'])add(lot,images.find(e=>e.entityType==='CYCLE'&&e.entityId===cycle.id&&e.kind===kind),farmSite?`site:${farmSite.id}`:`farm:${cycle.farmId}`,
            kind==='CYCLE_IMAGE'?'Vùng canh tác':kind==='CARE_IMAGE'?'Công việc chăm sóc':'Hoạt động thu hoạch');
        }
      }
      for(const line of lines.filter(l=>l.lotId===lot.id))for(const [party,site]of [['senderId','senderSiteId'],['receiverId','receiverSiteId'],['carrierId','carrierSiteId']])
        if(line.transfer[party]===org.id&&line.transfer[site])siteIds.add(line.transfer[site]);
      const shipment=shipments.find(s=>s.lotId===lot.id);
      if(shipment&&[shipment.transporterOrgId,shipment.retailerOrgId].includes(org.id)) {
        const image=images.find(e=>e.organizationId===org.id&&e.entityType==='SITE'&&e.kind==='SITE_IMAGE');
        add(lot,image,`org:${org.id}`,'Cơ sở tiếp nhận và giao nhận');
      }
      for(const siteId of siteIds)for(const image of images.filter(e=>e.organizationId===org.id&&e.entityType==='SITE'&&e.entityId===siteId&&e.kind==='SITE_IMAGE').slice(0,2))
        add(lot,image,`site:${siteId}`,'Hình ảnh cơ sở bảo quản và xử lý hàng');
    }
    const privateFarmIds=new Set(lots.filter(l=>l.harvest?.cycle.farm.privacy==='PRIVATE').map(l=>l.harvest.cycle.farmId));
    const presentation={publicDirectory:{published:true,catalogDetailsPublished:true,traceDetailsPublished:true,
      phone:profile.phone,address:[profile.ward,profile.province].filter(Boolean).join(', '),province:profile.province,ward:profile.ward,website:null,introduction:profile.description,logoEvidenceId:logo.id,
      traceSites:sites.filter(s=>s.organizationId===org.id&&!privateFarmIds.has(s.farmId)).map(s=>({id:s.id,name:s.name,address:[s.ward,s.region].filter(Boolean).join(', ')})),
      traceFarms:[...new Map(lots.filter(l=>l.farmOrgId===org.id&&l.harvest?.cycle.farm.privacy==='PUBLIC').map(l=>[l.harvest.cycle.farmId,{id:l.harvest.cycle.farmId,name:l.harvest.cycle.farm.name,address:l.harvest.cycle.farm.region}])).values()],traceMedia}};
    const hex=sha(`presentation:${receipt.generation}:${org.id}:${canonicalize(presentation)}`);
    const id=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
    await db.publicDirectoryPublication.upsert({where:{id},create:{id,organizationId:org.id,presentation},update:{}});
  }
}

try{await main();}catch(error){console.error(error.message);process.exitCode=1;}finally{await db.$disconnect();}
