// Runs inside the existing Worker image. Credentials arrive only on stdin.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import pg from 'pg';
import {loadConfig, connectGateway, FabricBlockchainAdapter} from './blockchain/gateway/dist/index.js';

const input = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(input.profile ?? 'fabric','fabric','Production verification requires Fabric');
assert.ok(!input.environment || input.environment === 'production','Only production verification is supported');
const tokens = {};
const sessions = {};
const refresh = [];
const principals = {};
let scopedDatabase;
let scopedRuntime;
let scopePolicy;
let canaryEvidence = null;
let proofCoverageEvidence;
let proofWindow = {at: Date.now(), count: 0, waits: 0};
let phase = 'health';
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
let connection;
async function http(route, role, body, expected=body === undefined ? 200 : 201, key, options={}) {
  if(scopePolicy && route.startsWith('/blockchain/events/')) {
    // Reserve at most 50 calls/window per smoke: two authenticated runs plus
    // their negative samples still fit the existing 120/min proof bucket.
    if(proofWindow.count >= 50) {
      const remaining=60000-(Date.now()-proofWindow.at);
      if(remaining>0) { await new Promise(resolve=>setTimeout(resolve,remaining+100)); proofWindow.waits++; }
      proofWindow={...proofWindow,at:Date.now(),count:0};
    }
    proofWindow.count++;
  }
  const response = await fetch(`${input.origin}/api${route}`, {
    method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15000),
    headers: {...(role ? {Authorization:`Bearer ${tokens[role]}`} : {}), ...(body ? {'Content-Type':'application/json'} : {}), ...(key ? {'Idempotency-Key':key} : {}), ...(options.cookie ? {Cookie:options.cookie} : {})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  assert.equal(response.status,expected);
  const data = (await response.json()).data;
  if(options.onSession)options.onSession(readSessionCredential(response,data,options.previous,
    Boolean(input.canary)||input.requireSessionFamily===true));
  return data;
}

function exact(value, keys) {
  assert(value && typeof value==='object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
}
function canonicalDigest(value) { return createHash('sha256').update(canonicalize(value)).digest('hex'); }
const uuid = value => assert.match(value??'',/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const digest = value => assert.match(value??'',/^[a-f0-9]{64}$/);
const revision = value => assert(Number.isSafeInteger(value) && value>=0);
const roleSlots = ['FARM_STAFF','TRANSPORTER','RETAILER','AUDITOR'];
const capabilityForRole = {FARM_STAFF:'FARM',TRANSPORTER:'TRANSPORTER',RETAILER:'RETAILER',AUDITOR:'AUDITOR'};
const authorityKeys = ['chainId','accountRole','userId','organizationId','grantId','grantRevision','membershipId','membershipVersion','capabilityRevision','profileVersion'];
function validateAuthority(entry, canary=false) {
  exact(entry,canary?[...authorityKeys,'routeDigest','catalog']:[...authorityKeys,'scopedRole']);
  for(const key of ['chainId','userId','organizationId','grantId','membershipId'])uuid(entry[key]);
  for(const key of ['grantRevision','membershipVersion','capabilityRevision','profileVersion'])revision(entry[key]);
  assert(roleSlots.includes(entry.accountRole));
  if(canary) {
    assert.equal(entry.accountRole,'FARM_STAFF'); digest(entry.routeDigest);
    exact(entry.catalog,['farmId','plotId','productId']); Object.values(entry.catalog).forEach(uuid);
  } else assert(roleSlots.includes(entry.scopedRole));
}
function validateScopePolicy(policy) {
  exact(policy,['schema','mode','reviewDigest','scopedCanary','proofCoverage','deniedProof']);
  assert.equal(policy.schema,'agritrace-production-verification/2');assert.equal(policy.mode,'scoped-a');
  digest(policy.reviewDigest);
  const {reviewDigest,...reviewed}=policy;
  assert.equal(canonicalDigest(reviewed),reviewDigest);
  validateAuthority(policy.scopedCanary,true);
  assert(Array.isArray(policy.proofCoverage) && policy.proofCoverage.length>0 && policy.proofCoverage.length<=256);
  policy.proofCoverage.forEach(entry=>validateAuthority(entry));
  assert.equal(new Set(policy.proofCoverage.map(entry=>`${entry.chainId}:${entry.accountRole}:${entry.scopedRole}`)).size,policy.proofCoverage.length);
  exact(policy.deniedProof,['chainId','accountRole','userId','organizationId']);
  for(const key of ['chainId','userId','organizationId'])uuid(policy.deniedProof[key]);
  assert(roleSlots.includes(policy.deniedProof.accountRole));
  return policy;
}
function reviewedCanaryRequest() {
  const request=input.canaryRequest;
  exact(request,['schema','sourceSha','operation','idempotencyKey','payload','requestDigest','allowFirstSubmit']);
  assert.equal(request.schema,'agritrace-canary-command/1'); assert.equal(request.sourceSha,input.canary);
  assert.equal(request.operation,'CREATE_PRODUCTION_CYCLE');assert.equal(request.idempotencyKey,`cd-${input.canary}`);
  assert.equal(typeof request.allowFirstSubmit,'boolean');digest(request.requestDigest);
  const body={chainId:scopePolicy.scopedCanary.chainId,...scopePolicy.scopedCanary.catalog,
    cycleCode:`CD-${input.canary.slice(0,20)}`,maxHarvestQuantity:1,harvestUnit:'kg'};
  assert.equal(canonicalDigest(request.payload),canonicalDigest(body),'Original reviewed canary body differs');
  assert.equal(canonicalDigest(request.payload),request.requestDigest);
  return request;
}
function assertPrincipal(entry) {
  const current=principals[entry.accountRole];
  assert.equal(current.id,entry.userId);assert.equal(current.organizationId,entry.organizationId);
  assert.equal(current.accountStatus,'ACTIVE');assert.equal(current.role.code,entry.accountRole);
}
async function authLifecycle() {
  phase='refresh-logout';
  const lifecycleSession=sessions.AUDITOR;
  let rotatedSession;
  const request=sessionRequest(lifecycleSession);
  const rotated=await http('/auth/refresh',undefined,request.body,201,undefined,{cookie:request.cookie,previous:lifecycleSession,
    onSession:(credential)=>{rotatedSession=credential;refresh.push(credential);}});
  assert.ok(rotated.accessToken&&rotatedSession);
  tokens.LIFECYCLE=rotated.accessToken;
  assert.equal((await http('/auth/me','LIFECYCLE')).role.code,'AUDITOR');
  const logout=sessionRequest(rotatedSession);
  await http('/auth/logout',undefined,logout.body,201,undefined,{cookie:logout.cookie});
  await http('/auth/refresh',undefined,logout.body,401,undefined,{cookie:logout.cookie});
  if(rotatedSession.kind==='family')await http('/auth/me','LIFECYCLE',undefined,401);
}
async function startScopedVerification() {
  phase='scoped-policy';
  scopePolicy=validateScopePolicy(input.scopeVerification);
  const modules=await Promise.all([
    import('@prisma/adapter-pg'),import('./apps/api/dist/generated/prisma/client.js'),
    import('./apps/api/dist/modules/supply-chains/business-read-scope.js'),
    import('./apps/api/dist/modules/supply-chains/legacy-scope-pins.js'),
    import('./apps/api/dist/modules/trace/ledger-route.js'),
    import('./apps/api/dist/modules/supply-chains/legacy-cutover-policy.js'),
  ]);
  const [{PrismaPg},{PrismaClient},readPolicy,legacyPolicy,routePolicy,cutoverPolicy]=modules;
  scopedRuntime={...readPolicy,...legacyPolicy,...routePolicy,...cutoverPolicy};
  scopedDatabase=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
  const canary={...scopePolicy.scopedCanary,scopedRole:'FARM_STAFF'};
  const entries=[canary,...scopePolicy.proofCoverage];
  for(const entry of [...entries,scopePolicy.deniedProof])assertPrincipal(entry);
  const contexts={};
  for(const accountRole of new Set(entries.map(entry=>entry.accountRole)))contexts[accountRole]=await http('/chain-permissions',accountRole);
  const checkedProfiles=new Set();
  for(const entry of entries) {
    const context=contexts[entry.accountRole];
    assert(context.businessScopeActivated===true && context.businessChains.includes(entry.chainId));
    assert(context.grants.some(grant=>grant.id===entry.grantId && grant.userId===entry.userId && grant.organizationId===entry.organizationId &&
      grant.chainId===entry.chainId && grant.scope==='CHAIN' && grant.role===entry.scopedRole && grant.revision===entry.grantRevision && grant.revokedAt===null));
    assert(context.memberships.some(member=>member.id===entry.membershipId && member.chainId===entry.chainId && member.organizationId===entry.organizationId &&
      member.status==='ACTIVE' && member.version===entry.membershipVersion));
    assert(context.capabilities.some(cap=>cap.organizationId===entry.organizationId && cap.code===capabilityForRole[entry.scopedRole] &&
      cap.revision===entry.capabilityRevision && cap.revokedAt===null));
    const key=entry.accountRole+':'+entry.chainId;
    if(!checkedProfiles.has(key)) {
      const profile=await http(`/supply-chains/${entry.chainId}/business-profile`,entry.accountRole);
      assert.equal(profile.state,'ACTIVE');assert.equal(profile.scopeVersion,1);assert.equal(profile.version,entry.profileVersion);
      checkedProfiles.add(key);
    }
  }
  assert(contexts.FARM_STAFF.productionChains.some(chain=>chain.id===canary.chainId));
  await scopedRead(async tx=>{
    for(const entry of entries)await currentAuthority(tx,entry);
    assert(await tx.farm.findFirst({where:{id:canary.catalog.farmId,organizationId:canary.organizationId,status:'ACTIVE'}}));
    assert(await tx.plot.findFirst({where:{id:canary.catalog.plotId,farmId:canary.catalog.farmId,status:'ACTIVE'}}));
    assert(await tx.product.findFirst({where:{id:canary.catalog.productId,status:'ACTIVE'}}));
    const route=await tx.ledgerRouteDefinition.findUnique({where:{digest:canary.routeDigest}});
    scopedRuntime.assertPinnedLedgerRoute(route);
    assert.equal(route.mode,'WRITE');assert.equal(route.envelopeVersion,'3.0.0');
    assert.equal(route.digest,process.env.LEDGER_ACTIVE_ROUTE_DIGEST);
  });
  // Check ALL retained subjects before allowing a fresh canary mutation.
  await scopedCoverage();
}
async function scopedRead(work) {
  return scopedDatabase.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return work(tx);
  },{isolationLevel:'RepeatableRead',timeout:120000});
}
async function currentAuthority(tx,entry) {
  assert(await tx.user.findFirst({where:{id:entry.userId,organizationId:entry.organizationId,accountStatus:'ACTIVE',organization:{status:'ACTIVE'}}}));
  assert(await tx.scopedRoleGrant.findFirst({where:{id:entry.grantId,userId:entry.userId,organizationId:entry.organizationId,
    chainId:entry.chainId,scope:'CHAIN',role:entry.scopedRole,revision:entry.grantRevision,revokedAt:null}}));
  assert(await tx.chainMembership.findFirst({where:{id:entry.membershipId,chainId:entry.chainId,organizationId:entry.organizationId,status:'ACTIVE',version:entry.membershipVersion}}));
  assert(await tx.organizationCapability.findFirst({where:{organizationId:entry.organizationId,code:capabilityForRole[entry.scopedRole],revision:entry.capabilityRevision,revokedAt:null}}));
  assert(await tx.chainBusinessProfile.findFirst({where:{chainId:entry.chainId,state:'ACTIVE',scopeVersion:1,version:entry.profileVersion}}));
}
async function scopedCoverage() {
  return scopedRead(async tx=>{
    const events=await tx.traceEvent.findMany({include:{cycle:{select:{id:true,chainId:true}},lot:{include:{harvest:{include:{cycle:{select:{id:true,chainId:true}}}}}},
      chainContext:true,ledgerRoute:{include:{definition:true,import:true}},blockchainProof:true},orderBy:{id:'asc'},take:10001});
    assert(events.length>0 && events.length<=10000);
    const readers=[];
    for(const entry of scopePolicy.proofCoverage) {
      await currentAuthority(tx,entry);
      const actor={sub:entry.userId,organizationId:entry.organizationId,role:entry.accountRole};
      const cycles=await tx.productionCycle.findMany({where:{AND:[{chainId:entry.chainId},scopedRuntime.scopedCycleReadWhere(actor)]},select:{id:true},take:10001});
      const lots=await tx.lot.findMany({where:{AND:[{harvest:{cycle:{chainId:entry.chainId}}},scopedRuntime.scopedLotReadWhere(actor)]},select:{id:true},take:10001});
      assert(cycles.length<=10000 && lots.length<=10000);
      readers.push({entry,cycles:new Set(cycles.map(row=>row.id)),lots:new Set(lots.map(row=>row.id))});
    }
    const denied=scopePolicy.deniedProof;
    const deniedActor={sub:denied.userId,organizationId:denied.organizationId,role:denied.accountRole};
    const deniedCycles=new Set((await tx.productionCycle.findMany({where:{AND:[{chainId:denied.chainId},scopedRuntime.scopedCycleReadWhere(deniedActor)]},select:{id:true},take:10001})).map(row=>row.id));
    const deniedLots=new Set((await tx.lot.findMany({where:{AND:[{harvest:{cycle:{chainId:denied.chainId}}},scopedRuntime.scopedLotReadWhere(deniedActor)]},select:{id:true},take:10001})).map(row=>row.id));
    const selected=new Map();let deniedSample;
    for(const event of events) {
      const root=event.lotId?event.lot?.harvest?.cycle:event.cycle;
      assert(root && (!event.cycleId || event.cycleId===root.id),'Trace subjects disagree');
      const route=scopedRuntime.verifiedEventRoute(event);assert(route,'Unverified historical route');
      const chainId=root.chainId;
      if(!chainId) {
        assert(await tx.productionCycle.findFirst({where:{AND:[{id:root.id},scopedRuntime.uncutoverLegacyCycleWhere()]},select:{id:true}}),
          'Unresolved legacy scope cannot be omitted from coverage');
        selected.set(event.id,{role:'SYSTEM_ADMIN',route,event});continue;
      }
      assert.equal(event.chainContext?.chainId,chainId);assert.equal(event.chainContext?.scopeVersion,1);
      await scopedRuntime.assertLegacyScopeProvenance(tx,root.id);
      const reader=readers.find(value=>value.entry.chainId===chainId && (event.lotId?value.lots.has(event.lotId):value.cycles.has(root.id)));
      assert(reader,'Retained event has no reviewed eligible principal');
      selected.set(event.id,{role:reader.entry.accountRole,route,event});
      if(chainId===denied.chainId && !(event.lotId?deniedLots.has(event.lotId):deniedCycles.has(root.id)))deniedSample??=event.id;
    }
    assert(deniedSample,'No reviewed scoped denial sample');
    return {selected,deniedSample};
  });
}
async function scopedCanary() {
  phase='scoped-canary';const request=reviewedCanaryRequest();
  const inspect=()=>http('/command-requests/status','FARM_STAFF',{operation:request.operation,payload:request.payload},200,request.idempotencyKey);
  let status=await inspect();let submitted=false;
  if(status.status==='NOT_FOUND') {
    assert.equal(request.allowFirstSubmit,true,'Unknown prior submission is held');submitted=true;
    try { await http('/production-cycles','FARM_STAFF',request.payload,201,request.idempotencyKey); }
    catch(error) {
      // A lost response may still be a commit. Inspect only; no automatic retry
      // when there is no positive immutable result journal.
      status=await inspect();assert.equal(status.status,'COMMITTED');
    }
    status=await inspect();
  }
  assert.equal(status.status,'COMMITTED');assert.equal(status.responseStatus,201);uuid(status.result?.id);
  const cycleId=status.result.id;
  const before=await canaryCommit(request,cycleId);
  const replay=await http('/production-cycles','FARM_STAFF',request.payload,201,request.idempotencyKey);
  assert.equal(replay.id,cycleId);
  assert.deepEqual(await canaryCommit(request,cycleId),before);
  canaryEvidence={operation:request.operation,requestDigest:request.requestDigest,resourceId:cycleId,submitted,replayed:true,noDuplicate:true};
  return {id:cycleId};
}
async function canaryCommit(request,cycleId) {
  return scopedRead(async tx=>{
    const canary=scopePolicy.scopedCanary;
    const cycles=await tx.productionCycle.findMany({where:{cycleCode:request.payload.cycleCode,chainId:canary.chainId,farmOrgId:canary.organizationId},take:2});
    assert.equal(cycles.length,1);assert.equal(cycles[0].id,cycleId);
    assert.equal(cycles[0].farmId,canary.catalog.farmId);assert.equal(cycles[0].productId,canary.catalog.productId);assert.equal(cycles[0].plotId,canary.catalog.plotId);
    const assignments=await tx.stageAssignment.findMany({where:{chainId:canary.chainId,cycleId,organizationId:canary.organizationId,stage:'PRODUCTION',status:'ACCEPTED'},take:2});
    assert.equal(assignments.length,1);
    const events=await tx.traceEvent.findMany({where:{entityType:'PRODUCTION_CYCLE',entityId:cycleId,eventType:'PRODUCTION_CYCLE_CREATED'},
      include:{blockchainOutbox:true,chainContext:true,ledgerRoute:{include:{definition:true,import:true}}},take:2});
    assert.equal(events.length,1);assert(events[0].blockchainOutbox);
    assert.equal(events[0].cycleId,cycleId);assert.equal(events[0].chainContext?.chainId,canary.chainId);
    assert.equal(scopedRuntime.verifiedEventRoute(events[0])?.digest,canary.routeDigest);
    const commits=await tx.commandCommit.findMany({where:{requesterId:canary.userId,operation:request.operation,
      idempotencyRecord:{idempotencyKey:request.idempotencyKey,requestHash:request.requestDigest}},include:{idempotencyRecord:true},take:2});
    assert.equal(commits.length,1);assert.equal(commits[0].responseStatus,201);assert.equal(commits[0].responseBody.id,cycleId);
    assert.equal(commits[0].idempotencyRecord.requestHash,request.requestDigest);
    return {cycleId,cycleVersion:cycles[0].version,assignmentId:assignments[0].id,eventId:events[0].id,outboxId:events[0].blockchainOutbox.id,commitId:commits[0].id};
  });
}
try {
  assert.equal((await fetch(`${input.origin}/login`,{signal:AbortSignal.timeout(15000)})).status,200);
  assert.equal((await fetch(`${input.origin}/api/docs`,{signal:AbortSignal.timeout(15000)})).status,404);
  await http('/health');
  const response = await fetch('http://127.0.0.1:8081/health/ready');
  assert.equal(response.status,200);
  const health=await response.json();
  assert.equal(health.runtime.enabled,true);
  assert.equal(health.runtime.running,true);
  assert.equal(health.runtime.lastError,null);
  assert.equal(health.backlog.deadLetter,0);
  phase='cors';
  const corsOrigins=input.corsOrigins??[input.origin];
  for(const origin of [...corsOrigins,'https://unapproved.example']){
    const preflight=await fetch(`${input.origin}/api/auth/login`,{
      method:'OPTIONS',signal:AbortSignal.timeout(15000),headers:{Origin:origin,
        'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,authorization,idempotency-key'},
    });
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('access-control-allow-origin'),corsOrigins.includes(origin)?origin:null);
    if(corsOrigins.includes(origin)){
      const allowed=preflight.headers.get('access-control-allow-headers').toLowerCase();
      for(const header of ['content-type','authorization','idempotency-key'])assert.ok(allowed.includes(header));
    }
  }
  phase='pwa';
  const manifestResponse=await fetch(`${input.origin}/manifest.webmanifest`,{signal:AbortSignal.timeout(15000)});
  assert.equal(manifestResponse.status,200);
  const manifest=await manifestResponse.json();
  assert.ok(manifest.start_url&&manifest.icons.length>0);
  assert.equal((await fetch(`${input.origin}/sw.js`,{signal:AbortSignal.timeout(15000)})).status,200);
  phase='roles';
  for(const role of ['SYSTEM_ADMIN','FARM_STAFF','TRANSPORTER','RETAILER','AUDITOR']){
    const account=input.accounts.find(a=>a.role===role);
    assert.ok(account);
    const auth=await http('/auth/login',undefined,{email:account.email,password:account.password},201,undefined,
      {onSession:(credential)=>{sessions[role]=credential;refresh.push(credential);}});
    tokens[role]=auth.accessToken;
    principals[role]=await http('/auth/me',role);
    assert.equal(principals[role].role.code,role);
  }
  await http('/organizations','AUDITOR',{name:'CD forbidden write',type:'FARM'},403);
  if(!input.scopeVerification)await authLifecycle();
  await db.connect();
  const gatewayConfig=loadConfig(process.env);
  connection=await connectGateway(gatewayConfig);
  const adapter=new FabricBlockchainAdapter(connection.gateway,gatewayConfig);
  if(input.scopeVerification)await startScopedVerification();
  if(input.canary){
    phase='canary';
    assert.match(input.canary,/^[a-f0-9]{40}$/);
    const catalog=input.canaryCatalog??{farmId:'6bb639b5-924a-4e82-8d80-000000000201',
      plotId:'6bb639b5-924a-4e82-8d80-000000000203',productId:'6bb639b5-924a-4e82-8d80-000000000202'};
    assert.ok(!input.environment||input.canaryCatalog,'Environment delivery requires a reviewed canary catalog');
    const cycle=scopePolicy?await scopedCanary():await http('/production-cycles','FARM_STAFF',{
      ...catalog,cycleCode:`CD-${input.canary.slice(0,20)}`,
      maxHarvestQuantity:1,harvestUnit:'kg',
    },201,`cd-${input.canary}`);
    const deadline=Date.now()+180000;
    let confirmed=false;
    do {
      const result=await db.query(`SELECT e.event_id,p.transaction_status,o.status FROM trace_event e
        LEFT JOIN blockchain_proof p USING(event_id) LEFT JOIN blockchain_outbox o USING(event_id)
        WHERE e.entity_id=$1 AND e.event_type='PRODUCTION_CYCLE_CREATED'`,[cycle.id]);
      confirmed=result.rows.length===1&&result.rows[0].transaction_status==='CONFIRMED';
      if(!confirmed)await new Promise(resolve=>setTimeout(resolve,2000));
    }while(!confirmed&&Date.now()<deadline);
    assert.ok(confirmed,'Canary proof did not confirm');
  }
    // A confirmed canary can overtake another aggregate's Pending predecessor.
    // Wait for the retained backlog too before taking the proof snapshot.
    phase='outbox-drain';
    const deadline=Date.now()+180000;
    let incomplete;
    do{
      const result=await db.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE o.status IS DISTINCT FROM 'COMPLETED'
          OR p.transaction_status IS DISTINCT FROM 'CONFIRMED')::int AS incomplete,
        count(*) FILTER (WHERE o.status='DEAD_LETTER')::int AS dead_letter
        FROM trace_event e LEFT JOIN blockchain_outbox o USING(event_id)
        LEFT JOIN blockchain_proof p USING(event_id)`);
      const progress=result.rows[0];
      assert.ok(progress.total<=10000,'Verification event budget exceeded');
      assert.equal(progress.dead_letter,0,'Dead-letter events require reconciliation');
      incomplete=progress.incomplete;
      if(incomplete>0)await new Promise(resolve=>setTimeout(resolve,2000));
    }while(incomplete>0&&Date.now()<deadline);
    assert.equal(incomplete,0,'Retained outbox did not drain within the verification window');
  phase='database-and-ledger';
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const events=(await db.query(`SELECT e.event_id,e.entity_type,e.entity_id,e.data_hash,e.previous_event_hash,
    to_jsonb(e)::text AS immutable_row,p.tx_id,p.data_hash AS proof_hash,p.channel_id,p.transaction_status,o.status
    FROM trace_event e LEFT JOIN blockchain_proof p USING(event_id) LEFT JOIN blockchain_outbox o USING(event_id)
    ORDER BY e.created_at,e.event_id`)).rows;
  const qrs=(await db.query('SELECT lot_id,trace_token FROM trace_qr ORDER BY trace_qr_id')).rows;
  const counts={};
  for(const table of ['app_user','organization','farm','plot','product','production_cycle','harvest_event','lot','shipment','trace_event','blockchain_outbox','blockchain_proof'])
    counts[table]=Number((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  await db.query('COMMIT');
  assert.ok(events.length>0&&events.length<=10000,'Verification event budget exceeded');
  const fingerprints={};
  const groups=new Map();
  const coverage=scopePolicy?await scopedCoverage():null;
  if(coverage)assert.equal(coverage.selected.size,events.length,'Coverage snapshot differs from retained events');
  for(const event of events){
    fingerprints[`event:${event.event_id}`]=createHash('sha256').update(event.immutable_row).digest('hex');
    if(event.tx_id)fingerprints[`proof:${event.event_id}`]=createHash('sha256').update(JSON.stringify([event.tx_id,event.proof_hash,event.channel_id])).digest('hex');
    assert.equal(event.status,'COMPLETED');assert.equal(event.transaction_status,'CONFIRMED');
    const selected=coverage?.selected.get(event.event_id);
    if(coverage) {
      assert(selected,'Retained proof coverage is incomplete');
      for(const [field,key] of [['network','networkName'],['channelId','channelName'],['chaincodeName','chaincodeName'],['contractName','contractName']]) {
        const configured=key==='networkName'?process.env.FABRIC_NETWORK_NAME:gatewayConfig[key];
        assert.equal(selected.route[field],configured,'No approved reader for historical destination');
      }
      assert.equal(selected.event.dataHash,event.data_hash);
      assert.equal(selected.event.blockchainProof?.txId,event.tx_id);
    }
    const [actual,proof,apiProof]=await Promise.all([adapter.queryEvent(event.event_id),adapter.getProof(event.event_id),http(`/blockchain/events/${event.event_id}/verify`,selected?.role??'SYSTEM_ADMIN')]);
    assert.equal(actual.eventId,event.event_id);assert.equal(actual.dataHash,event.data_hash);
    assert.equal(actual.previousEventHash??null,event.previous_event_hash??null);
    assert.equal(proof.txId,event.tx_id);assert.equal(proof.dataHash,event.proof_hash);
    assert.equal(event.proof_hash,event.data_hash);assert.equal(event.channel_id,gatewayConfig.channelName);
    assert.equal(apiProof.localHashMatches,true);assert.equal(apiProof.status,'CONFIRMED');
    assert.equal(apiProof.deliveryStatus,'COMPLETED');assert.equal(apiProof.txId,event.tx_id);
    if(selected) {
      const source=selected.event;
      assert.equal(apiProof.eventId,event.event_id);assert.equal(apiProof.dataHash,event.data_hash);
      assert.equal(apiProof.channelId,selected.route.channelId);assert(apiProof.recordedAt);
      assert.equal(new Date(apiProof.recordedAt).toISOString(),new Date(source.blockchainProof.recordedAt).toISOString());
      assert.equal(apiProof.proofStatus,'VERIFIED');
      for(const [field,expected] of Object.entries({entityType:source.entityType,entityId:source.entityId,
        cycleId:source.cycleId??undefined,lotId:source.lotId??undefined,eventType:source.eventType,
        eventTime:new Date(source.eventTime).toISOString(),schemaVersion:source.schemaVersion,
        canonicalizationVersion:source.canonicalizationVersion}))assert.equal(actual[field],expected);
      if(selected.route.envelopeVersion==='3.0.0') {
        assert.equal(actual.envelopeVersion,'3.0.0');assert.equal(actual.nonce,event.event_id);
      }
      assert.equal(proof.channelId,selected.route.channelId);assert.equal(proof.network,selected.route.network);
      assert.equal(new Date(proof.recordedAt).toISOString(),new Date(source.blockchainProof.recordedAt).toISOString());
    }
    const key=(selected?`${selected.route.network}:${selected.route.channelId}:${selected.route.chaincodeName}:${selected.route.contractName}:`:'')+event.entity_type+':'+event.entity_id;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(event);
  }
  for(const events of groups.values()){
    const first=events[0];
    const head=await adapter.getEntityHead(first.entity_type,first.entity_id);
    let history;
    if(events.length<=100)history=await adapter.queryEntityHistory(first.entity_type,first.entity_id);
    else {
      history=[];let bookmark='';const bookmarks=new Set();
      for(let page=0;page<10000 && history.length<events.length;page++) {
        const result=await adapter.queryEntityHistoryPage(first.entity_type,first.entity_id,Math.min(500,events.length-history.length),bookmark);
        assert(Array.isArray(result.records) && result.records.length>0 && result.records.length<=500);
        assert.equal(result.fetchedRecordsCount,result.records.length);
        history.push(...result.records);assert(history.length<=events.length);
        if(history.length===events.length)break;
        assert(typeof result.bookmark==='string' && result.bookmark && !bookmarks.has(result.bookmark));
        bookmarks.add(result.bookmark);bookmark=result.bookmark;
      }
    }
    assert.equal(head.eventCount,events.length);assert.equal(history.length,events.length);
    assert.deepEqual(history.map(e=>e.eventId).sort(),events.map(e=>e.event_id).sort());
    assert.ok(events.some(e=>e.event_id===head.lastEventId&&e.data_hash===head.lastDataHash));
  }
  if(coverage) {
    phase='scoped-proof-denials';
    const sample=coverage.deniedSample;
    for(const role of ['SYSTEM_ADMIN',scopePolicy.deniedProof.accountRole]) {
      const denied=await http(`/blockchain/events/${sample}/verify`,role,undefined,404);
      assert(denied===undefined || denied===null || Object.keys(denied).length===0);
      await http('/blockchain/events/00000000-0000-4000-8000-000000000000/verify',role,undefined,404);
    }
    proofCoverageEvidence={eligible:events.length,covered:events.length,total:events.length,negativeSamples:2,nonexistentSamples:2};
  }
  phase='public-qr';
  const legacyIds=input.legacyQrLotIds??[];
  assert.ok(Array.isArray(legacyIds)&&legacyIds.every(id=>typeof id==='string'&&id.length>0));
  const legacyLots=new Set(legacyIds);
  assert.equal(legacyLots.size,legacyIds.length);
  assert.ok(legacyIds.every(id=>qrs.some(qr=>qr.lot_id===id)),'Legacy QR disappeared');
  let legacyQR=0;
  for(const qr of qrs){
    const trace=await http(`/public/trace/${qr.trace_token}`);
    assert.equal(trace.lotId,qr.lot_id);
    if(legacyLots.has(qr.lot_id)){
      assert.equal(trace.proofStatus,'INTEGRITY_WARNING');
      assert.equal(trace.sensorEvidence.status,'LEGACY_UNVERIFIED');
      assert.equal(trace.sensorEvidence.readingCount,0);
      assert.equal(trace.sensorEvidence.digestHash,null);
      for(const field of ['periodStart','periodEnd','finalizedAt'])assert.equal(trace.sensorEvidence[field],null);
      assert.equal(trace.quantityReconciled,true);assert.equal(trace.stateReconciled,true);
      assert.ok(trace.warnings.includes('LEGACY_UNVERIFIED'));
      for(const warning of ['QUANTITY_MISMATCH','STATE_MISMATCH','SENSOR_INTEGRITY_WARNING'])assert.ok(!trace.warnings.includes(warning));
      legacyQR++;
    }else{
      assert.equal(trace.proofStatus,'VERIFIED');
    }
    assert.ok(trace.timeline.every(event=>event.proofStatus==='VERIFIED'));
    assert.equal((await fetch(`${input.origin}/trace/${qr.trace_token}`,{signal:AbortSignal.timeout(15000)})).status,200);
  }
  if(scopePolicy)await authLifecycle();
  console.log(JSON.stringify({result:'passed',counts,fingerprints,fabricVerification:'passed',
    directLedgerEvents:events.length,pendingEvents:0,entityHistories:groups.size,
    verifiedQR:qrs.length-legacyQR,legacyQR,roles:5,corsOrigins,refreshLogout:true,pwaAssets:true,canary:input.canary??null,
    ...(scopePolicy?{verificationMode:'scoped-a',policyDigest:scopePolicy.reviewDigest,authenticatedAccounts:5,
      canaryCommand:canaryEvidence,httpProofCoverage:proofCoverageEvidence,proofPacingWaits:proofWindow.waits}:{} )}));
}catch{
  console.error(`Release verification failed at ${phase}; sensitive diagnostics withheld`);
  process.exitCode=1;
}finally{
  connection?.close();
  await scopedDatabase?.$disconnect().catch(()=>{});
  await db.end().catch(()=>{});
  for(const credential of refresh){
    const request=sessionRequest(credential);
    await http('/auth/logout',undefined,request.body,201,undefined,{cookie:request.cookie}).catch(()=>{});
  }
}
