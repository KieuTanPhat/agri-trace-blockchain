// Runs inside the existing Worker image. Credentials arrive only on stdin.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {loadConfig, connectGateway, FabricBlockchainAdapter} from './blockchain/gateway/dist/index.js';

const input = JSON.parse(readFileSync(0, 'utf8'));
const tokens = {};
const sessions = {};
const refresh = [];
let phase = 'health';
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
let connection;
async function http(route, role, body, expected=body === undefined ? 200 : 201, key, options={}) {
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
    assert.equal((await http('/auth/me',role)).role.code,role);
  }
  await http('/organizations','AUDITOR',{name:'CD forbidden write',type:'FARM'},403);
  phase='refresh-logout';
  // Reuse Auditor after its permission check; keep Admin alive for proofs and
  // stay within the ten-login limit across baseline + candidate verification.
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
  await db.connect();
  const gatewayConfig=loadConfig(process.env);
  connection=await connectGateway(gatewayConfig);
  const adapter=new FabricBlockchainAdapter(connection.gateway,gatewayConfig);
  if(input.canary){
    phase='canary';
    assert.match(input.canary,/^[a-f0-9]{40}$/);
    const cycle=await http('/production-cycles','FARM_STAFF',{
      farmId:'6bb639b5-924a-4e82-8d80-000000000201',plotId:'6bb639b5-924a-4e82-8d80-000000000203',
      productId:'6bb639b5-924a-4e82-8d80-000000000202',cycleCode:`CD-${input.canary.slice(0,20)}`,
      maxHarvestQuantity:1,harvestUnit:'kg',
    },201,`cd-${input.canary}`);
    const deadline=Date.now()+180000;
    let confirmed=false;
    do {
      const result=await db.query(`SELECT e.event_id,p.transaction_status FROM trace_event e
        LEFT JOIN blockchain_proof p USING(event_id) WHERE e.entity_id=$1 AND e.event_type='PRODUCTION_CYCLE_CREATED'`,[cycle.id]);
      confirmed=result.rows.length===1&&result.rows[0].transaction_status==='CONFIRMED';
      if(!confirmed)await new Promise(resolve=>setTimeout(resolve,2000));
    }while(!confirmed&&Date.now()<deadline);
    assert.ok(confirmed,'Canary proof did not confirm');
  }
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
  assert.ok(events.length>0&&events.length<=10000,'Verification requires 1..10000 UAT events');
  const fingerprints={};
  const groups=new Map();
  for(const event of events){
    assert.equal(event.status,'COMPLETED');assert.equal(event.transaction_status,'CONFIRMED');
    const [actual,proof,apiProof]=await Promise.all([adapter.queryEvent(event.event_id),adapter.getProof(event.event_id),http(`/blockchain/events/${event.event_id}/verify`,'SYSTEM_ADMIN')]);
    assert.equal(actual.eventId,event.event_id);assert.equal(actual.dataHash,event.data_hash);
    assert.equal(actual.previousEventHash??null,event.previous_event_hash??null);
    assert.equal(proof.txId,event.tx_id);assert.equal(proof.dataHash,event.proof_hash);
    assert.equal(event.proof_hash,event.data_hash);assert.equal(event.channel_id,gatewayConfig.channelName);
    assert.equal(apiProof.localHashMatches,true);assert.equal(apiProof.status,'CONFIRMED');
    assert.equal(apiProof.deliveryStatus,'COMPLETED');assert.equal(apiProof.txId,event.tx_id);
    fingerprints[event.event_id]=createHash('sha256').update(JSON.stringify([event.immutable_row,event.tx_id,event.proof_hash,event.channel_id])).digest('hex');
    const key=event.entity_type+':'+event.entity_id;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(event);
  }
  for(const events of groups.values()){
    const first=events[0];
    const [head,history]=await Promise.all([adapter.getEntityHead(first.entity_type,first.entity_id),adapter.queryEntityHistory(first.entity_type,first.entity_id)]);
    assert.equal(head.eventCount,events.length);assert.equal(history.length,events.length);
    assert.deepEqual(history.map(e=>e.eventId).sort(),events.map(e=>e.event_id).sort());
    assert.ok(events.some(e=>e.event_id===head.lastEventId&&e.data_hash===head.lastDataHash));
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
  console.log(JSON.stringify({result:'passed',counts,fingerprints,directLedgerEvents:events.length,entityHistories:groups.size,verifiedQR:qrs.length-legacyQR,legacyQR,roles:5,corsOrigins,refreshLogout:true,pwaAssets:true,canary:input.canary??null}));
}catch{
  console.error(`Release verification failed at ${phase}; sensitive diagnostics withheld`);
  process.exitCode=1;
}finally{
  connection?.close();
  await db.end().catch(()=>{});
  for(const credential of refresh){
    const request=sessionRequest(credential);
    await http('/auth/logout',undefined,request.body,201,undefined,{cookie:request.cookie}).catch(()=>{});
  }
}
