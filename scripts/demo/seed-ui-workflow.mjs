// Additive, local-only fixture loader. Domain/trace writes use the real HTTP API.
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { simulateChainBinding, confirmSimulatedPermissions } from '../../apps/api/dist/modules/ledger/simulated-ledger.js';
import { requestLedgerGrant } from '../../apps/api/dist/modules/ledger/ledger-permissions.js';
import { appendPlatformAudit, lockPlatformAudit } from '../../apps/api/dist/modules/platform-governance/platform-audit.js';
import { workflowPlan, workflowId, assertWorkflowTarget, UI_WORKFLOW_NAMESPACE } from './ui-workflow-plan.mjs';

config({path:'apps/api/.env',quiet:true});
const target=assertWorkflowTarget(process.env), args=process.argv.slice(2);
assert.ok(args.every(a=>['--verify','--dry-run','--pilot'].includes(a)),'Unknown seed argument');
assert.ok(!args.includes('--pilot')||target.rehearsal,'Pilot is isolated rehearsal only');
const full=workflowPlan(), plan=args.includes('--pilot')?{...full,products:[full.products[0],full.products[70]]}:full;
if(args.includes('--dry-run')) {console.log(JSON.stringify({database:target.database,api:target.apiBase,organizations:30,products:plan.products.length,additive:true}));process.exit(0);}
assert.notEqual(process.env.ENTERPRISE_PAYMENTS_ENABLED,'true','This dataset uses deferred service activation, never fabricated paid subscriptions');
const requireApi=createRequire(new URL('../../apps/api/package.json',import.meta.url));
const { hash }=requireApi('bcrypt');
const sharp=createRequire(new URL('../../apps/web/package.json',import.meta.url))('sharp');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const lockClient=new pg.Client({connectionString:process.env.DATABASE_URL});
const dir=resolve('.codex/ui-workflow-100',target.database), statePath=resolve(dir,'state.json');
await mkdir(dir,{recursive:true,mode:0o700});
const fingerprint=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const unwrap=x=>x?.record??x;
let state;
try {state=JSON.parse(await readFile(statePath,'utf8'));} catch(e){if(e.code!=='ENOENT')throw e;}
assert.ok(!state||(state.database===target.database&&state.namespace===UI_WORKFLOW_NAMESPACE),'Checkpoint belongs to another dataset/database');
const credentialPath=resolve(dir,'accounts.json');
const credentials=state?JSON.parse(await readFile(credentialPath,'utf8')):[];
async function save(){await writeFile(statePath+'.tmp',JSON.stringify(state,null,2),{mode:0o600});await rename(statePath+'.tmp',statePath);}
async function child(command,argv,stdin,stdout){
 return new Promise((ok,no)=>{const p=spawn(command,argv,{stdio:[stdin??'ignore',stdout??'pipe','pipe']});let err='';p.stderr.on('data',b=>{err+=b.toString().slice(0,200)});p.on('error',no);p.on('exit',code=>code===0?ok():no(Error(`${command} failed (${code}); diagnostic retained locally`)));});
}
async function backup(){
 const file=resolve(dir,`before-${Date.now()}.dump`),handle=await open(file,'wx',0o600);
 try{await child('docker',['exec','postgres','pg_dump','-U','postgres','-d',target.database,'--format=custom'],undefined,handle.fd);}finally{await handle.close();}
 const input=await open(file,'r'),list=await open(file+'.list','wx',0o600);
 try{await child('docker',['exec','-i','postgres','pg_restore','--list'],input.fd,list.fd);}finally{await input.close();await list.close();}
 const bytes=await readFile(file);assert.ok(bytes.length>10000,'Backup too small');
 assert.match(await readFile(file+'.list','utf8'),/_prisma_migrations/,'Backup inventory unreadable');
 return {file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
const protectedTables=['app_user','organization','product','farm','production_cycle','harvest_event','lot','care_record','trace_event','trace_evidence','command_commit','platform_audit'];
async function snapshot(){
 const result=[];
 for(const table of protectedTables){
  const keys=await db.$queryRawUnsafe(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY a.attnum`,table);
  assert.ok(keys.length,'Missing primary key');
  const rows=await db.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM "${table}" t`);
  result.push({table,keys:keys.map(k=>k.attname),rows:rows.map(({row})=>({key:Object.fromEntries(keys.map(k=>[k.attname,row[k.attname]])),hash:fingerprint(row)}))});
 }
 return result;
}
async function preserveOriginal(){
 for(const section of state.baseline){
  for(const original of section.rows){
   const pairs=Object.entries(original.key),where=pairs.map(([k],i)=>`"${k}"=$${i+1}`).join(' AND ');
   const rows=await db.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM "${section.table}" t WHERE ${where}`,...pairs.map(([,v])=>v));
   assert.equal(rows.length,1,`Original row missing in ${section.table}`);
   assert.equal(fingerprint(rows[0].row),original.hash,`Original row changed in ${section.table}; reconcile concurrent activity`);
  }
 }
}
function userFor(org,tier){return credentials.find(c=>c.organizationId===org.id&&c.tier===tier);}
async function bootstrap(){
 const created=await db.organization.count({where:{id:{in:plan.organizations.map(o=>o.id)}}});
 if(created){assert.equal(created,30,'Partial bootstrap must be reconciled');assert.equal(await db.user.count({where:{id:{in:credentials.map(c=>c.id)}}}),90);return;}
 const admin=await db.user.findFirst({where:{role:{code:'SYSTEM_ADMIN'}},select:{id:true}});
 assert.ok(admin,'Create the local platform admin before loading the dataset');
 assert.equal(await db.user.count({where:{email:{in:credentials.map(c=>c.email)}}}),0,'Existing emails cannot be overwritten');
 const hashes=new Map();for(const c of credentials)hashes.set(c.id,await hash(c.password,10));
 await db.$transaction(async tx=>{
  await lockPlatformAudit(tx);
  for(const org of plan.organizations){
   const roleCode=org.type==='FARM'?'FARM_STAFF':org.type;
   const role=await tx.role.upsert({where:{code:roleCode},create:{code:roleCode,name:roleCode},update:{}});
   await tx.organization.create({data:{id:org.id,name:org.name,type:org.type,status:'ACTIVE'}});
   const owner=userFor(org,1),manager=userFor(org,2);
   for(const c of credentials.filter(c=>c.organizationId===org.id))await tx.user.create({data:{
    id:c.id,email:c.email,passwordHash:hashes.get(c.id),fullName:c.fullName,roleId:role.id,organizationId:org.id,
    enterpriseTier:c.tier,memberCode:`NV000${c.tier}`,jobTitle:c.tier===1?'[DEMO] Chủ quản':c.tier===2?'[DEMO] Quản lý':'[DEMO] Nhân viên',
    supervisorId:c.tier===1?null:c.tier===2?owner.id:manager.id,phone:c.phone,contactAddress:'[DEMO] Địa chỉ thử nghiệm, không liên hệ thực tế',
    passwordChangedAt:new Date(state.startedAt),mustChangePassword:false,
   }});
   await tx.organizationCapability.upsert({where:{organizationId_code:{organizationId:org.id,code:org.type}},create:{organizationId:org.id,code:org.type},update:{}});
   await tx.enterpriseEnrollment.create({data:{id:workflowId(`enrollment:${org.key}`,0),organizationId:org.id,ownerId:owner.id,
    registrationDigest:fingerprint({namespace:UI_WORKFLOW_NAMESPACE,id:org.id}),businessId:`DEMO100-${org.key.toUpperCase()}`,
    hostingMode:'MANAGED_ORG',status:'APPROVED',reviewedBy:admin.id,reviewNote:'Synthetic local dataset; not legal review',
    serviceActivatedAt:new Date(state.startedAt),serviceActivatedBy:admin.id,serviceActivationReason:'Owner-authorized local UI dataset; temporary access, no payment',
   }});
   await tx.enterpriseProfile.create({data:{organizationId:org.id,legalForm:org.type==='FARM'?'COOPERATIVE':'ENTERPRISE',
    address:'[DEMO] Cơ sở thử nghiệm, không phải địa chỉ kinh doanh thật',province:'Thành phố Hồ Chí Minh',ward:'Phường Hòa Lợi',
    phone:owner.phone,contactEmail:`${org.key}@example.test`,representative:owner.fullName,activities:[org.type],
    description:'Dữ liệu tổng hợp phục vụ kiểm thử; không phải doanh nghiệp, hàng hóa hoặc chứng nhận thật.',
    declarationAcceptedAt:new Date(state.startedAt),registrationData:{synthetic:true,seedNamespace:UI_WORKFLOW_NAMESPACE},legalData:{synthetic:true},
   }});
   for(const role of ['ORG_ADMIN',...(['FARM','PROCESSOR'].includes(org.type)?['CREATE_CHAIN']:[])])await tx.scopedRoleGrant.create({data:{userId:owner.id,organizationId:org.id,scope:'ORGANIZATION',role}});
  }
  await appendPlatformAudit(tx,{actor:null,action:'LOCAL_UI_WORKFLOW_BOOTSTRAPPED',subjectType:'LOCAL_DATASET',subjectId:UI_WORKFLOW_NAMESPACE,
   reason:'Owner authorized additive local fixtures; no payment, proof, trace or existing rows modified',details:{organizations:30,accounts:90,database:target.database}});
 },{timeout:60000});
}
const sessions=new Map();let lastRequest=0;
async function pause(ms){while(ms>0){const n=Math.min(ms,10000);await new Promise(r=>setTimeout(r,n));ms-=n;}}
async function raw(actor,path,body,key,form){
 const wait=250-(Date.now()-lastRequest);if(wait>0)await pause(wait);lastRequest=Date.now();
 const headers={...(actor?{Authorization:`Bearer ${actor.token}`}:{})};if(key)headers['Idempotency-Key']=key;
 if(body!==undefined&&!form)headers['content-type']='application/json';
 let response;
 for(let attempt=0;attempt<4;attempt++){
  response=await fetch(`${target.apiBase}${path}`,{method:body===undefined&&!form?'GET':'POST',headers,...(form?{body:form}:body!==undefined?{body:JSON.stringify(body)}:{})});
  if(response.status!==429)break;
  await response.arrayBuffer();console.log('Rate limit: waiting with the same request/key.');await pause(61000);
 }
 const wire=await response.json();
 if(!response.ok)throw Object.assign(Error(`${path}: ${response.status} ${JSON.stringify(wire.error?.message??wire.message??'request failed')}`),{status:response.status});
 return wire.data??wire;
}
async function actor(org,tier=1){
 const c=userFor(org,tier);if(sessions.has(c.id))return sessions.get(c.id);
 const result=await raw(null,'/auth/login',{email:c.email,password:c.password});
 assert.equal(result.user.id,c.id,'API identity is not the target database');
 assert.equal(result.user.organizationId,org.id);assert.equal(result.user.mustChangePassword,false);
 const value={...c,token:result.accessToken};assert.ok(value.token);sessions.set(c.id,value);return value;
}
async function command(a,path,body,label,formFactory){
 let entry=state.commands[label];
 if(entry?.complete)return entry.result;
 if(entry){
  const records=await db.idempotencyRecord.findMany({where:{requesterId:a.id,idempotencyKey:entry.key},include:{commandCommit:true}});
  assert.ok(records.length<=1,'Ambiguous command identity; reconcile manually');
  const journal=records[0];
  if(journal?.commandCommit){entry.result=journal.commandCommit.responseBody;entry.complete=true;await save();return entry.result;}
  const rejected=journal?.status==='FAILED'&&journal.responseStatus>=400;
  if(rejected||(!journal&&entry.validationRejected)){
   const previousRejected=[...(entry.previousRejected??[]),{key:entry.key,body:entry.body,recordId:journal?.id??null,responseStatus:journal?.responseStatus??entry.responseStatus}];
   assert.ok(previousRejected.length<=3,'Repeated confirmed rejection; inspect seed inputs');
   entry=state.commands[label]={actorId:a.id,path,key:randomUUID(),body,previousRejected};await save();
  }
 }
 if(!entry){entry=state.commands[label]={actorId:a.id,path,key:randomUUID(),body};await save();}
 assert.equal(entry.path,path);assert.equal(entry.actorId,a.id);
 let result;
 try {result=await raw(a,path,entry.body,entry.key,formFactory?await formFactory(entry.body):undefined);}
 catch(e){entry.responseStatus=e.status??0;entry.validationRejected=[400,422].includes(e.status);await save();throw e;}
 entry.result=result;entry.complete=true;await save();return result;
}
const xml=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const imageCache=new Map();
async function image(label){
 if(!imageCache.has(label))imageCache.set(label,await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#eaf5ef"/><path d="M270 240Q190 100 400 90Q435 245 270 240" fill="#2d8052"/><text x="30" y="310" font-family="sans-serif" font-size="19" fill="#153f28">${xml(label.slice(0,55))}</text><text x="30" y="355" font-family="sans-serif" font-size="20" fill="#a72020">DEMO ONLY - NOT REAL EVIDENCE</text></svg>`)).jpeg({quality:65}).toBuffer());
 return imageCache.get(label);
}
async function evidence(a,type,id,kind,label,isPublic=false){
 const bytes=await image(label),filename=`demo-${kind.toLowerCase()}.jpg`;
 const input={entityType:type,entityId:id,kind,description:`[DEMO-100] ${label}. Ảnh minh họa tổng hợp; không phải chứng cứ sản xuất hoặc giấy tờ pháp lý thật.`,...(isPublic?{public:true,publicationConfirmed:true}:{})};
 return unwrap(await command(a,'/enterprise-workspace/evidence',input,`image:${type}:${id}:${kind}:${isPublic}`,async fields=>{
  const form=new FormData();for(const[k,v]of Object.entries(fields))form.set(k,String(v));form.set('file',new Blob([bytes],{type:'image/jpeg'}),filename);return form;
 }));
}
async function chainPermissions(org,chainId){
 await db.$transaction(async tx=>{
  const digest=await simulateChainBinding(tx,chainId);
  // Only new dataset accounts/chains may be bootstrapped; never edit existing grants.
  for(const c of credentials.filter(c=>c.organizationId===org.id)){
   const role=org.type==='FARM'?'FARM_STAFF':'PROCESSOR';
   let grant=await tx.scopedRoleGrant.findFirst({where:{userId:c.id,chainId,role,revokedAt:null}});
   if(!grant)grant=await tx.scopedRoleGrant.create({data:{userId:c.id,organizationId:org.id,chainId,scope:'CHAIN',role}});
   if(!await tx.ledgerPermissionEpoch.findUnique({where:{grantId:grant.id}}))await requestLedgerGrant(tx,grant);
  }
  await confirmSimulatedPermissions(tx,{bindingDigests:[digest]});
 },{timeout:30000});
}
async function setup(org){
 const a=await actor(org);let farm,plot,site;
 if(org.type==='FARM'){
  farm=unwrap(await command(a,'/catalog/farms',{organizationId:org.id,name:`[DEMO-100] Vùng ${org.key}`,kind:'CROP',region:'Khu thử nghiệm',address:'[DEMO] Khu sản xuất thử nghiệm, không phải địa chỉ thật',areaM2:1000,expectedOutput:1000,outputUnit:'kg',privacy:'PRIVATE'},`farm:${org.key}`));
  await evidence(a,'FARM',farm.id,'LAND_CERTIFICATE',`DEMO land-use placeholder ${org.key}`);
  await command(a,`/catalog/farms/${farm.id}/complete`,{version:farm.version},`farm-complete:${org.key}`);
  plot=unwrap(await command(a,'/catalog/plots',{farmId:farm.id,name:`[DEMO-100] Thửa ${org.key}`,area:1000,unit:'m2'},`plot:${org.key}`));
 }else if(org.type==='PROCESSOR'){
  site=unwrap(await command(a,'/enterprise-workspace/sites',{name:`[DEMO-100] Nhà xưởng ${org.key}`,kind:'PROCESSING',region:'Khu thử nghiệm',ward:'Phường Hòa Lợi',areaM2:200,address:'[DEMO] Địa chỉ nhà xưởng thử nghiệm'},`site:${org.key}`));
  await evidence(a,'SITE',site.id,'SITE_IMAGE',`DEMO processing site ${org.key}`);
  await command(a,`/enterprise-workspace/sites/${site.id}/complete`,{version:site.version},`site-complete:${org.key}`);
 }
 let chain;
 if(['FARM','PROCESSOR'].includes(org.type)){
  chain=unwrap(await command(a,'/supply-chains',{name:`[DEMO-100] Chuỗi ${org.key}`,chainType:org.type==='FARM'?'CROP':'PROCESSED_FOOD',description:'Chuỗi thử nghiệm local, ledger mô phỏng'},`chain:${org.key}`));
  const profile=await raw(a,`/supply-chains/${chain.id}/business-profile`);
  await command(a,`/supply-chains/${chain.id}/business-profile/activate`,{version:profile.version},`chain-active:${org.key}`);
  if(org.type==='FARM'){
   const role=unwrap(await command(a,'/enterprise-workspace/roles',{name:'[DEMO-100] Ghi nhật ký được giao',permissions:['production.read','production.write','evidence.read','evidence.manage','trace.read']},`role:${org.key}`));
   for(const tier of [2,3]){
    const c=userFor(org,tier),row=await db.user.findUniqueOrThrow({where:{id:c.id}});
    await command(a,`/enterprise-workspace/members/${c.id}`,{version:row.enterpriseRevision,status:'ACTIVE',roles:[{roleId:role.id,chainIds:[chain.id],siteIds:[farm.id]}],responsibleFarmId:farm.id},`member-role:${org.key}:${tier}`);
   }
  }
  await chainPermissions(org,chain.id);
 }
 return {a,farm,plot,site,chain};
}
const at=(days)=>new Date(new Date(state.startedAt).getTime()+days*86400000).toISOString();
async function produce(org,p,setup){
 const {a,farm,plot,site,chain}=setup;
 const product=unwrap(await command(a,'/catalog/products',{
  productName:p.name,sku:p.sku,category:p.processed?'[DEMO] Sản phẩm chế biến':'[DEMO] Nông sản',defaultUnit:'kg',price:p.price,
  variety:'Dữ liệu tổng hợp để kiểm thử',storageConditions:'[DEMO] Bảo quản khô thoáng; không phải hướng dẫn cho hàng thật',
  ingredients:'[DEMO] Thành phần minh họa',usageInstructions:'Chỉ dùng thử nghiệm phần mềm',description:'Dữ liệu thử nghiệm tổng hợp; không phải hàng hóa hoặc chứng nhận thật.',
  ...(farm?{originFarmId:farm.id}:{manufacturingSiteId:site.id}),
 },`product:${p.key}`));
 await evidence(a,'PRODUCT',product.id,'PRODUCT_IMAGE',p.name);
 await command(a,`/catalog/products/${product.id}/complete`,{version:product.version},`product-complete:${p.key}`);
 let lotId;
 if(!p.processed){
  const staff=await actor(org,3);
  const cycle=unwrap(await command(a,'/production-cycles',{name:`${p.name} - vụ thử nghiệm`,chainId:chain.id,farmId:farm.id,plotId:plot.id,productId:product.id,
   cultivatedArea:100,maxHarvestQuantity:100,harvestUnit:'kg',startDate:at(-30).slice(0,10),plannedHarvest:at(7).slice(0,10),staffUserIds:[staff.id],note:'[DEMO] Các thời điểm là dữ liệu tổng hợp'},`cycle:${p.key}`));
  await command(a,`/production-cycles/${cycle.id}/plant`,{version:cycle.version,plantedAt:at(-20)},`plant:${p.key}`);
  const care=await evidence(staff,'CYCLE',cycle.id,'CARE_IMAGE',`Nhật ký ${p.name}`);
  const current=await db.productionCycle.findUniqueOrThrow({where:{id:cycle.id}});
  await command(staff,`/production-cycles/${cycle.id}/care`,{version:current.version,name:`[DEMO] Tưới nước ${p.key}`,careType:'Tưới nước',eventTime:at(-10),evidenceRef:care.id,performerUserId:staff.id,note:'[DEMO] Nhật ký minh họa, không phải ghi nhận hiện trường thật'},`care:${p.key}`);
  const harvest=await evidence(a,'CYCLE',cycle.id,'HARVEST_IMAGE',`Thu hoạch ${p.name}`),lotImage=await evidence(a,'CYCLE',cycle.id,'LOT_IMAGE',p.name);
  const fresh=await db.productionCycle.findUniqueOrThrow({where:{id:cycle.id}});
  const result=await command(a,`/production-cycles/${cycle.id}/harvests`,{version:fresh.version,lotName:`${p.name} - lô 01`,representativeUserId:staff.id,evidenceRef:harvest.id,lotImageEvidenceRef:lotImage.id,harvestTime:at(-2),quantity:50,unit:'kg',expiryDate:at(30).slice(0,10),note:'[DEMO] Lô thử nghiệm có ledger PENDING, không phải hàng hóa thật'},`harvest:${p.key}`);
  lotId=result.lot.id;
 }else{
  const receipt=unwrap(await command(a,'/processing-runs/receipts',{siteId:site.id,materialName:`[DEMO] Nguyên liệu ${p.key}`,supplierName:'[DEMO] Nguồn ngoài nền tảng',documentNo:`DEMO100-${p.key}`,receivedAt:at(-5),quantity:'10.000',unit:'kg',note:'Chứng từ tổng hợp, không phải nhà cung cấp hoặc giao dịch thật'},`receipt:${p.key}`));
  await evidence(a,'MATERIAL_RECEIPT',receipt.id,'RECEIPT_DOCUMENT',`DEMO receipt ${p.key}`);
  const run=unwrap(await command(a,'/processing-runs',{chainId:chain.id,siteId:site.id,productId:product.id,processType:p.processType,baseUnit:'kg',inputs:[],externalInputs:[{receiptId:receipt.id,quantity:'10.000'}],note:'[DEMO] Mẻ minh họa cân bằng 10 = 8 + 2 kg'},`processing:${p.key}`));
  const started=unwrap(await command(a,`/processing-runs/${run.id}/start`,{version:run.version},`start:${p.key}`));
  await command(a,`/processing-runs/${run.id}/logs`,{step:'PACKING',occurredAt:new Date().toISOString(),note:'[DEMO] Nhật ký đóng gói minh họa'},`processing-log:${p.key}`);
  const result=unwrap(await command(a,`/processing-runs/${run.id}/complete`,{version:started.version,output:{quantity:'8.000',unit:'kg',lotName:`${p.name} - mẻ 01`,expiryDate:at(90).slice(0,10)},byProducts:[],losses:[{reason:'TRIMMING',quantity:'2.000',note:'[DEMO] Hao hụt minh họa'}]},`complete:${p.key}`));
  lotId=result.outputs[0].lotId;
 }
 await evidence(a,'LOT',lotId,'LOT_IMAGE',p.name,true);
 const qr=await db.traceQr.findUniqueOrThrow({where:{lotId}});
 state.products[p.key]={productId:product.id,lotId,traceToken:qr.traceToken,traceUrl:qr.traceUrl,name:p.name,organizationId:org.id};await save();
 console.log(`Ready ${Object.keys(state.products).length}/${plan.products.length}: ${p.key}`);
}
async function verify(){
 await preserveOriginal();
 assert.equal(Object.keys(state.products).length,plan.products.length,'Incomplete workflow');
 for(const field of ['productId','lotId','traceToken'])assert.equal(new Set(Object.values(state.products).map(p=>p[field])).size,plan.products.length,`Duplicate ${field}`);
 for(const p of plan.products){
  const record=state.products[p.key];assert.ok(record);
  const detail=await raw(null,`/public/products/${record.productId}`);assert.equal(detail.productName,p.name);assert.ok(detail.lots.items.some(l=>l.traceToken===record.traceToken));
  assert.ok(detail.imageUrl,'Public demo image missing');assert.equal(Number(detail.price),p.price,'Published demo catalog price missing');
  const trace=await raw(null,`/public/trace/${record.traceToken}`);assert.ok(trace,'Trace missing');
  const lot=await db.lot.findUniqueOrThrow({where:{id:record.lotId}});assert.equal(lot.productId,record.productId);assert.equal(lot.unit,'kg');
  if(p.processed){const run=await db.processingRun.findUniqueOrThrow({where:{id:lot.processingRunId}});assert.equal(run.status,'COMPLETED');assert.equal(run.inputTotal.toFixed(3),'10.000');assert.equal(run.outputTotal.toFixed(3),'8.000');assert.equal(run.lossTotal.toFixed(3),'2.000');}
  else {const harvest=await db.harvestEvent.findUniqueOrThrow({where:{id:lot.harvestId}});assert.ok(await db.careRecord.count({where:{cycleId:harvest.cycleId}}));}
 }
 const ids=Object.values(state.products).map(p=>p.lotId);
 const confirmed=await db.traceEvent.count({where:{lotId:{in:ids},blockchainProof:{is:{transactionStatus:'CONFIRMED'}}}});
 assert.equal(confirmed,0,'Simulated dataset cannot claim confirmed Fabric receipts');
 await writeFile(resolve(dir,'inventory.json'),JSON.stringify({database:target.database,api:target.apiBase,web:'http://localhost:3000',ledger:'SIMULATED/PENDING',organizations:plan.organizations,products:Object.values(state.products)},null,2),{mode:0o600});
 state.verifiedAt=new Date().toISOString();await save();console.log(JSON.stringify({verified:true,organizations:30,products:plan.products.length,originalRowsUnchanged:true,credentialFile:credentialPath,inventory:resolve(dir,'inventory.json')}));
}
async function publishDemoProfiles(){
 // Explicitly publish only the new synthetic organizations, never real contacts
 // or original enterprise profiles. Stable IDs prevent replay from republishing.
 for(const org of plan.organizations){
  const actual=await db.organization.findUniqueOrThrow({where:{id:org.id}});
  assert.equal(actual.name,org.name,'Dataset organization was edited; do not republish');
  const id=workflowId(`public-profile:${org.key}`,0);
  await db.publicDirectoryPublication.upsert({where:{id},update:{},create:{id,organizationId:org.id,presentation:{publicDirectory:{
   published:true,catalogDetailsPublished:true,phone:null,website:null,
   introduction:'[DEMO-100] Doanh nghiệp tổng hợp dùng kiểm thử; không phải tổ chức hoặc hàng hóa thật.',
   province:'Thành phố Hồ Chí Minh',ward:'Phường Hòa Lợi',address:'[DEMO] Địa chỉ thử nghiệm',
  }}}});
 }
}
try{
 await lockClient.connect();
 const locked=await lockClient.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held',[UI_WORKFLOW_NAMESPACE]);
 assert.equal(locked.rows[0].held,true,'Another dataset loader is running');
 const [identity]=await db.$queryRaw`SELECT current_database() AS database,pg_get_userbyid(datdba)=current_user AS owns,shobj_description(oid,'pg_database') AS description FROM pg_database WHERE datname=current_database()`;
 assert.equal(identity.database,target.database);assert.equal(identity.owns,true);
 if(target.rehearsal)assert.match(identity.description??'',/Codex owned.*workflow/);
 assert.equal(await db.fabricNetworkBinding.count({where:{network:{not:'simulated-ledger'}}}),0,'Real Fabric binding refuses this local seed');
 const unfinished=await db.$queryRaw`SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
 assert.equal(unfinished[0].count,0);
 if(!state){
  assert.ok(!args.includes('--verify'),'No checkpoint');
  assert.equal(await db.organization.count({where:{id:{in:plan.organizations.map(o=>o.id)}}}),0,'Dataset IDs already exist without their checkpoint');
  const baseline=await snapshot(),savedBackup=await backup();
  for(const [index,org]of plan.organizations.entries())for(const tier of [1,2,3])credentials.push({id:workflowId(`user:${org.key}`,tier),organizationId:org.id,tier,
   email:`demo100.${org.key}.${['','owner','manager','staff'][tier]}@example.test`,password:`Demo!${randomBytes(18).toString('base64url')}9a`,
   fullName:`[DEMO-100] ${org.key} ${['','Chủ quản','Quản lý','Nhân viên'][tier]}`,phone:`09${String(99000000+index*3+tier).padStart(8,'0')}`});
  await writeFile(credentialPath,JSON.stringify(credentials,null,2),{mode:0o600,flag:'wx'});
  state={version:1,namespace:UI_WORKFLOW_NAMESPACE,database:target.database,startedAt:new Date().toISOString(),backup:savedBackup,baseline,commands:{},products:{}};await save();
 }
 const bytes=await readFile(state.backup.file);assert.equal(createHash('sha256').update(bytes).digest('hex'),state.backup.sha256,'Backup changed');
 if(!args.includes('--verify')){
  await bootstrap();
  for(const org of plan.organizations){
   const selected=plan.products.filter(p=>p.owner===org.key);if(!selected.length)continue;
   const context=await setup(org);for(const p of selected)await produce(org,p,context);
  }
  await publishDemoProfiles();
 }
 await verify();
}catch(e){console.error(e instanceof Error?e.message:'Seed failed; keep checkpoint for reconciliation');process.exitCode=1;}
finally{
 for(const a of sessions.values())try{await raw(a,'/auth/logout-all',{});}catch{/* Existing accounts are never used; normal expiration still applies to dataset sessions. */}
 await lockClient.end();
 await db.$disconnect();
}
