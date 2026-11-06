import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { BindingConnectionPool } from '../../apps/api/dist/modules/ledger/binding-pool.js';
import { verifyStoredEvidence } from '../../apps/api/dist/modules/trace/event-evidence.js';
import {sourceManifest} from './local-fabric-build.mjs';
import {retryLedgerRead,retryVerificationHttp} from './local-fabric-recovery.mjs';

const repository=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const target=JSON.parse(await readFile(process.env.AGRITRACE_LOCAL_FABRIC_RECEIPT,'utf8'));
assert.equal(target.protocol,'agritrace-local-fabric/1');assert.equal(target.production,false);assert.equal(target.backup,null);
const pilot=process.argv.includes('--pilot');assert.equal(target.mode,pilot?'pilot':'application');
const run=process.env.AGRITRACE_LOCAL_FABRIC_RUN;
const progress=JSON.parse(await readFile(join(run,'progress.json'),'utf8'));
assert.equal(progress.generation,target.generation);
const connectionUrl=new URL(`postgresql://127.0.0.1:${target.pgPort}/agri_trace?schema=public`);
connectionUrl.username=process.env.POSTGRES_USER;connectionUrl.password=process.env.POSTGRES_PASSWORD;
const db=new PrismaClient({adapter:new PrismaPg({connectionString:connectionUrl.href})});
const pool=new BindingConnectionPool();
const api=`http://127.0.0.1:${target.apiPort}/api`;
const report={protocol:'agritrace-local-fabric-verification/1',generation:target.generation,pilot,startedAt:new Date().toISOString(),
  sourceHead:target.sourceHead,sourceDiffSha256:target.sourceDiffSha256,checks:[],counts:{},ledger:{checked:0,valid:0},allChecksPassed:false};
const accounts=JSON.parse(await readFile(join(run,'accounts.json'),'utf8')).users;
const sessions=new Map();
const digest=value=>createHash('sha256').update(value).digest('hex');
const verifiedFetch=(...args)=>retryVerificationHttp(()=>fetch(...args));
async function check(name,fn){await fn();report.checks.push(name);console.log(`PASS ${name}`);}
async function login(key) {
  if(sessions.has(key))return sessions.get(key);
  const account=accounts.find(a=>a.key===key);assert.ok(account);
  const consumer=account.role==='CONSUMER';
  const path=consumer?'/auth/mobile/login':'/auth/login';
  const payload=consumer?{phone:account.email.split('@')[0].replace(/^/,'+'),password:account.password}:{email:account.email,password:account.password};
  for(let attempt=0;attempt<18;attempt++) {
    const r=await verifiedFetch(api+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    if(r.status===429){await r.arrayBuffer();await new Promise(r=>setTimeout(r,10000));continue;}
    const value=await r.json();assert.equal(r.status,201,`Account ${key} could not log in`);
    const token=(value.data??value).accessToken;assert.ok(token);sessions.set(key,token);return token;
  }
  throw new Error(`Login throttle did not settle for ${key}`);
}
async function authenticated(key,path,options={}) {
  const r=await verifiedFetch(api+path,{...options,headers:{Authorization:`Bearer ${await login(key)}`,...options.headers}});
  const body=await r.json();return {status:r.status,data:body.data??body};
}
async function parallel(items,n,work) {let cursor=0;await Promise.all(Array.from({length:n},async()=>{while(cursor<items.length){const index=cursor++;await work(items[index],index);}}));}
try {
  report.sourceFiles={};
  for(const name of ['local-fabric-operator.mjs','local-fabric-target.mjs','local-fabric-recovery.mjs','local-fabric-schedule.mjs','local-fabric-build.mjs',
    'comprehensive-catalog.mjs','comprehensive-seed.mjs','comprehensive-coverage.mjs','prepare-comprehensive-assets.mjs','verify-local-fabric.mjs','local-fabric-batching.py'])
    report.sourceFiles[`scripts/demo/${name}`]=digest(await readFile(join(repository,'scripts/demo',name)));
  report.sourceCurrentDiffSha256=digest(execFileSync('git',['diff','--binary','HEAD'],{cwd:repository}));
  for(const name of ['apps/api/src/modules/auth/jwt-auth.guard.ts','apps/api/prisma/migrations/20261224000001_processing_reservation_reconciliation/migration.sql'])
    report.sourceFiles[name]=digest(await readFile(join(repository,name)));
  await check('owned local runtime and no simulator',async()=>{
    const containers=JSON.parse(execFileSync('docker',['inspect',...['api','worker','web','postgres'].map(s=>`${target.project}-${s}-1`)],{encoding:'utf8'}));
    for(const c of containers){assert.equal(c.Config.Labels['com.docker.compose.project'],target.project);
      if(c.Config.Labels['com.docker.compose.service']!=='postgres')assert.equal(c.Config.Labels['agritrace.local.generation'],target.generation);
      if(c.Config.Labels['com.docker.compose.service']==='api')assert.ok(!c.Mounts.some(m=>m.Destination==='/hosted-identities'),'API must not mount Fabric identities');
      const service=c.Config.Labels['com.docker.compose.service'];
      if(service!=='postgres'){
        const build=JSON.parse(await readFile(join(resolve(run,'..'),`build-${service==='worker'?'api':service}.json`),'utf8'));
        assert.equal(build.generation,target.generation);assert.equal(c.Image,build.imageId,'Runtime image differs from verified build');
        assert.equal(c.Config.Labels['agritrace.local.source.sha256'],build.source.digest,'Runtime source label differs from build manifest');
        assert.equal(sourceManifest(repository,service==='worker'?'api':service).digest,build.source.digest,'Build input set changed; rebuild before verification');
        for(const [path,hash]of Object.entries(build.source.files))assert.equal(digest(await readFile(join(repository,path))),hash,`Build source changed: ${path}`);
      }
    }
    const simulators=execFileSync('docker',['ps','-aq','--filter',`label=com.docker.compose.project=${target.project}`,'--filter','label=com.docker.compose.service=ledger-simulator'],{encoding:'utf8'}).trim();
    assert.equal(simulators,'');
    const worker=containers.find(c=>c.Config.Labels['com.docker.compose.service']==='worker');
    assert.equal(worker.State.Health.Status,'healthy');
    report.images=containers.map(c=>({service:c.Config.Labels['com.docker.compose.service'],imageId:c.Image}));
  });
  await check('database cardinalities, images and lifecycle allocation',async()=>{
    for(const table of ['organization','product','supplyChain','farm','plot','productionCycle','harvestEvent','lot','traceQr','careRecord',
      'processingRun','sensorReading','lateSensorReading','user','traceEvent','blockchainOutbox','blockchainProof','commandCommit','distributionTransfer','shipment'])report.counts[table]=await db[table].count();
    assert.equal(report.counts.organization,20);assert.equal(report.counts.user,94);assert.equal(report.counts.supplyChain,8);
    if(!pilot) {
      for(const [table,count]of Object.entries({product:232,farm:12,plot:48,productionCycle:100,harvestEvent:240,lot:300,traceQr:300,careRecord:2000,processingRun:75}))assert.equal(report.counts[table],count,table);
      const states=await db.productionCycle.groupBy({by:['currentState'],_count:true});
      const actual=Object.fromEntries(states.map(s=>[s.currentState,s._count]));
      assert.deepEqual(actual,{CANCELLED:5,COMPLETED:55,CREATED:5,GROWING:25,PLANTED:10});
      assert.equal(await db.productionCycle.findMany({distinct:['productId']}).then(x=>x.length),100);
      assert.equal(await db.lot.findMany({distinct:['productId']}).then(x=>x.length),113);
      const photos=await db.traceEvidence.findMany({where:{entityType:'PRODUCT',kind:'PRODUCT_IMAGE'},select:{entityId:true,sha256:true}});
      assert.equal(photos.length,232);assert.equal(new Set(photos.map(p=>p.entityId)).size,232);
      assert.equal(new Set(photos.map(p=>p.sha256)).size,232,'Each product must use its own source image');
      const logos=await db.traceEvidence.findMany({where:{entityType:'PROFILE',fileName:{startsWith:'logo-O'}},select:{entityId:true,sha256:true}});
      assert.equal(logos.length,20);assert.equal(new Set(logos.map(p=>p.entityId)).size,20);assert.equal(new Set(logos.map(p=>p.sha256)).size,20);
      const groups=await db.processingRun.groupBy({by:['status'],_count:true});report.processingStates=Object.fromEntries(groups.map(g=>[g.status,g._count]));
      assert.deepEqual(report.processingStates,{CANCELLED:3,COMPLETED:60,DRAFT:6,IN_PROGRESS:6});
    }
    report.cycleStates=await db.productionCycle.groupBy({by:['currentState'],_count:true});
    report.lotStates=await db.lot.groupBy({by:['currentState'],_count:true});
    report.businessMonths=await db.$queryRawUnsafe(`SELECT to_char(start_date,'YYYY-MM') AS month,count(*)::int AS cycles FROM production_cycle GROUP BY 1 ORDER BY 1`);
    if(!pilot)assert.equal(report.businessMonths.length>=12,true,'Business dates must cover the planned year');
    if(!pilot) {
      assert.ok(report.businessMonths.every(m=>m.cycles>=8&&m.cycles<=9),'Monthly allocation must stay within 8–9 cycles');
      const source=JSON.parse(await readFile(join(run,'bootstrap.json'),'utf8'));
      const organizations=await db.productionCycle.groupBy({by:['farmOrgId'],_count:true});
      report.cyclesByEnterprise=organizations.map(row=>({organization:row.farmOrgId,count:row._count}));
      assert.deepEqual(organizations.map(row=>row._count).sort((a,b)=>a-b),[33,33,34]);
      const production=progress.steps.production,farms=progress.steps.resources.farms;
      const regions={};
      for(const cycle of production.cycles){const farm=farms.find(f=>f.id===cycle.farmId);assert.ok(farm);const region=['BAC','TRUNG','NAM',source.orgs[cycle.owner].region][farm.index];regions[region]=(regions[region]??0)+1;}
      report.cyclesByRegion=regions;
      assert.deepEqual(Object.values(regions).sort((a,b)=>a-b),[33,33,34]);
    }
  });
  await check('quantity, custody and processing mass balance',async()=>{
    assert.equal(await db.idempotencyRecord.count({where:{status:'PROCESSING',commandCommit:null}}),0,'Unresolved command outcome requires reconciliation');
    const queries=[
      `SELECT l.lot_id FROM lot l LEFT JOIN quantity_movement m ON m.lot_id=l.lot_id GROUP BY l.lot_id HAVING l.available_quantity <> COALESCE(sum(m.delta),0)`,
      `SELECT l.lot_id FROM lot l WHERE EXISTS(SELECT 1 FROM shipment s WHERE s.lot_id=l.lot_id) AND EXISTS(SELECT 1 FROM lot_holding h WHERE h.lot_id=l.lot_id)`,
      `SELECT l.lot_id FROM lot l WHERE EXISTS(SELECT 1 FROM lot_holding h WHERE h.lot_id=l.lot_id) AND l.available_quantity <> COALESCE((SELECT sum(h.quantity) FROM lot_holding h WHERE h.lot_id=l.lot_id),0)+COALESCE((SELECT sum(d.quantity) FROM distribution_line d JOIN distribution_transfer t ON t.id=d.transfer_id WHERE d.lot_id=l.lot_id AND t.status='IN_TRANSIT'),0)`,
      `SELECT lot_id FROM lot_site_holding WHERE quantity<0 OR reserved<0 OR quarantined<0 OR reserved+quarantined>quantity`,
      `SELECT id FROM processing_run WHERE status='COMPLETED' AND input_total<>output_total+loss_total`,
    ];
    for(const query of queries)assert.equal((await db.$queryRawUnsafe(query)).length,0,'Quantity/custody mismatch');
  });
  await check('sealed sensor windows and stored private evidence',async()=>{
    assert.equal(await db.harvestSensorWindow.count(),report.counts.harvestEvent);
    const windows=await db.harvestSensorWindow.findMany();
    if(!pilot){assert.ok(windows.some(w=>w.status==='NO_DATA'));assert.ok(report.counts.lateSensorReading>0);}
    for(const w of windows){assert.ok(w.sealedAt);if(w.status==='NO_DATA'){assert.equal(w.readingCount,0);assert.equal(w.digestHash,null);}else{assert.ok(w.readingCount>0);assert.ok(w.digestHash);}}
    const stored=await verifyStoredEvidence(db,{});assert.equal(stored.failed.length,0);report.storedEvidence=stored;
  });
  await check('every event read back from Fabric with VALID transaction status',async()=>{
    const bindings=await db.fabricNetworkBinding.findMany();assert.ok(bindings.length>0);
    assert.ok(bindings.every(b=>b.network===target.instance));
    pool.setPlatformBindings(bindings);const byDigest=new Map(bindings.map(b=>[b.digest,b]));
    const clients=new Map();
    for(const binding of bindings){const connection=await pool.get(binding,'relayer');clients.set(binding.digest,connection);
      assert.equal((await connection.client.getRegistryBinding(binding.digest)).status,'ACTIVE');}
    const events=await db.traceEvent.findMany({select:{id:true,dataHash:true,entityType:true,entityId:true,eventType:true,bindingContext:true,blockchainProof:true}});
    assert.ok(events.length>0);assert.equal(report.counts.blockchainOutbox,events.length);assert.equal(report.counts.blockchainProof,events.length);
    assert.equal(await db.blockchainOutbox.count({where:{status:{not:'COMPLETED'}}}),0);
    await parallel(events,2,async event=>{
      const digest=event.bindingContext?.bindingDigest;const binding=byDigest.get(digest);assert.ok(binding,'Missing pinned event binding');
      const proof=event.blockchainProof;assert.equal(proof?.transactionStatus,'CONFIRMED');assert.ok(proof.txId);assert.equal(proof.network,binding.network);assert.equal(proof.dataHash,event.dataHash);
      const client=clients.get(digest).client;
      const [remote,remoteEvent,validation]=await retryLedgerRead(()=>Promise.all([client.getBindingProof(binding.chainRef,event.id),client.queryBindingEvent(binding.chainRef,event.id),client.transactionValidationCode(proof.txId)]));
      assert.equal(remote.txId,proof.txId);assert.equal(remote.dataHash,event.dataHash);assert.equal(remote.bindingDigest,digest);assert.equal(remote.eventId,event.id);
      assert.equal(remoteEvent.dataHash,event.dataHash);assert.equal(validation,0,'Transaction must be VALID in qscc');
      report.ledger.checked++;report.ledger.valid++;
      if(report.ledger.checked%250===0)console.log(`Verified ${report.ledger.checked}/${events.length} ledger proofs`);
    });
    report.ledger.bindings=bindings.length;
    report.ledger.signedEvents=await db.eventActorSignature.count();assert.ok(report.ledger.signedEvents>0,'A real signed handover is required');
    report.ledger.confirmedHandovers=await db.shipmentHandover.count({where:{state:'CONFIRMED'}});assert.ok(report.ledger.confirmedHandovers>0);
    for(const connection of clients.values())pool.release(connection);
  });
  await check('every QR resolves and reconciles without private data',async()=>{
    const qrs=await db.traceQr.findMany();let checked=0;
    await parallel(qrs,4,async qr=>{
      const r=await verifiedFetch(api+`/public/trace/${encodeURIComponent(qr.traceToken)}`);assert.equal(r.status,200);
      const response=await r.json(),data=response.data??response;
      assert.equal(data.quantityReconciled,true);assert.equal(data.stateReconciled,true);
      const body=JSON.stringify(data);assert.ok(!/passwordHash|accessToken|privateKey|HASH_MISMATCH/.test(body));
      assert.ok(!/@agritrace\.local|@phone\.invalid/.test(body),'QR must not disclose account identifiers');
      const personnel=accounts.filter(a=>a.orgKey&&a.tier>1).map(a=>a.fullName).filter(Boolean);
      for(const name of new Set(personnel))assert.ok(!body.includes(name),'QR must not disclose employee names');
      assert.equal(new URL(qr.traceUrl).origin,target.publicOrigin);checked++;
    });
    report.qrChecked=checked;
  });
  await check('account login, role boundaries and append-only platform audit',async()=>{
    const selected=pilot?['admin','O01','O08','O03','O06','O13Staff1']:accounts.map(a=>a.key);
    for(const [index,key]of selected.entries()){await login(key);if((index+1)%10===0)console.log(`Verified account login ${index+1}/${selected.length}`);}
    report.accountsChecked=selected.length;
    const count=await db.productionCycle.count();const cycle=progress.steps.production.cycles[0];
    const index=Number(cycle.cycleCode.split('-').at(-1))-1;
    const original=JSON.parse(await readFile(join(run,'commands',digest(`cycle:${cycle.chainKey}:${index}`)+'.json'),'utf8'));
    const payload={...original.body,cycleCode:'DENIED-SCOPE-CHECK'};
    for(const key of ['admin','O13Staff1']) {
      const r=await authenticated(key,'/production-cycles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':`denied-${target.generation}-${key}`},body:JSON.stringify(payload)});
      assert.equal(r.status,403,'Admin/reviewer must not perform production commands');
    }
    assert.equal(await db.productionCycle.count(),count);
    const audit=await authenticated('admin','/platform-audit/verify');assert.equal(audit.status,200);assert.equal(audit.data.ok,true);report.auditVerified=true;
  });
  await check('original signed-command replay creates no extra history or quantity movement',async()=>{
    const handover=await db.shipmentHandover.findFirstOrThrow({orderBy:{offeredAt:'asc'}});
    const record=JSON.parse(await readFile(join(run,'commands',digest(`pickup-offer:${handover.shipmentId}:submit`)+'.json'),'utf8'));
    const before=[await db.traceEvent.count(),await db.quantityMovement.count(),await db.shipmentHandover.count()];
    const response=await authenticated(record.actorKey,record.route,{method:record.method,
      headers:{'content-type':'application/json','Idempotency-Key':record.key},body:JSON.stringify(record.body)});
    assert.equal(response.status,201);
    assert.deepEqual([await db.traceEvent.count(),await db.quantityMovement.count(),await db.shipmentHandover.count()],before);
    report.replayVerified=true;
  });
  if(!pilot)await check('supported exceptions and independent inspection access',async()=>{
    const coverage=progress.steps['coverage-exceptions'];assert.ok(coverage);
    assert.equal((await db.shipment.findUniqueOrThrow({where:{id:coverage.failure}})).status,'FAILED');
    assert.equal((await db.shipment.findUniqueOrThrow({where:{id:coverage.rejection}})).status,'REJECTED');
    for(const [key,state]of [['expiredHandover','EXPIRED'],['cancelledHandover','CANCELLED'],['rejectedHandover','REJECTED']])
      assert.equal((await db.shipmentHandover.findUniqueOrThrow({where:{id:coverage[key]}})).state,state);
    assert.equal((await db.distributionReturn.findUniqueOrThrow({where:{id:coverage.returnId}})).status,'RETURNED');
    assert.ok(await db.processingLog.count({where:{step:'CORRECTION'}})>=3);
    assert.equal(await db.consumerReport.count(),3);
    const review=await authenticated('O13Staff1','/production-cycles');assert.equal(review.status,200);
    const foreign=progress.steps.production.cycles.find(c=>c.owner==='O08');assert.ok(foreign);
    const denied=await authenticated('O01Staff1',`/production-cycles/${foreign.id}`);assert.ok([403,404].includes(denied.status),'Staff must not see another organization cycle');
    const bootstrap=JSON.parse(await readFile(join(run,'bootstrap.json'),'utf8'));
    for(const key of ['O17','O18']){
      assert.equal(await db.organizationCapability.count({where:{organizationId:bootstrap.orgs[key].id,revokedAt:null}}),0,'Unapproved enrollment must have no business capability');
      const response=await authenticated(key,'/production-cycles');assert.ok([200,403].includes(response.status));
      if(response.status===200)assert.deepEqual(response.data,[],'Unapproved enrollment must not see production records');
    }
  });
  report.allChecksPassed=true;report.completedAt=new Date().toISOString();
  await writeFile(join(run,'verification.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.log(`Verified ${report.counts.lot} lots, ${report.qrChecked} QR and ${report.ledger.valid} VALID Fabric events.`);
}catch(error){report.failure=error.message;await writeFile(join(run,'verification-failed.json'),JSON.stringify(report,null,2),{mode:0o600});console.error(error.message);process.exitCode=1;}
finally{pool.onModuleDestroy();await db.$disconnect();}
