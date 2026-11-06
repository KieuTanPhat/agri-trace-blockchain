// Explicitly authorized local installation only. Does not use production flags or controllers.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize } from 'json-canonicalize';
import { assertOwnedLocalStack, assertLocalFabricReceipt, remainingResetContainers, LOCAL_PROJECT, TARGET_PROTOCOL } from './local-fabric-target.mjs';
import {sourceManifest as collectSourceManifest} from './local-fabric-build.mjs';

const repository=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const directory=join(repository,'.codex/local-fabric');
const pilot=process.argv.includes('--pilot');
const work=pilot?join(directory,'pilot'):directory;
const targetFile=join(work,'target.json');
mkdirSync(join(work,'logs'),{recursive:true});
function run(file,args,options={}) {
  return execFileSync(file,args,{cwd:repository,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe'],...options});
}
const docker=(...args)=>run('docker',args);
const json=(path)=>JSON.parse(readFileSync(path,'utf8'));
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2),{mode:0o600});
const wslPath=path=>'/mnt/'+path[0].toLowerCase()+path.slice(2).replaceAll('\\','/');
const target=()=>json(targetFile);

function sourceManifest(name) {
  return collectSourceManifest(repository,name);
}

function ensureWsl() {
  const keepalive=join(directory,'wsl-keepalive.json');let alive=false;
  if(existsSync(keepalive)) {
    const record=json(keepalive);
    if(record.repository===repository&&Number.isInteger(record.pid))try{
      alive=run('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${record.pid} -ErrorAction Stop).ProcessName`]).trim()==='wsl';
    }catch{}
  }
  if(!alive) {
    const child=spawn('wsl.exe',['-d','Ubuntu','--','sleep','infinity'],{detached:true,stdio:'ignore',windowsHide:true});
    child.unref();save(keepalive,{repository,pid:child.pid,createdAt:new Date().toISOString()});
  }
  try{run('wsl',['-d','Ubuntu','--','docker','info','--format','{{.ID}}']);}
  catch{run('wsl',['-d','Ubuntu','-u','root','--','service','docker','start']);}
}

function initialize() {
  if(existsSync(targetFile)) { console.log('Generation already prepared; use existing target and resume.'); return; }
  const resources=JSON.parse(docker('inspect',...['api','worker','web','postgres'].map(s=>`${LOCAL_PROJECT}-${s}-1`)));
  const ownership=assertOwnedLocalStack(resources,repository);
  const generation=randomBytes(16).toString('hex');
  const instance=`agritrace-local-${generation.slice(0,12)}`;
  const receipt={protocol:TARGET_PROTOCOL,generation,repository,production:false,backup:null,
    project:pilot?`agritrace-seed-pilot-${generation.slice(0,8)}`:LOCAL_PROJECT,
    mode:pilot?'pilot':'application',instance,network:`${instance}-network`,
    publicOrigin:pilot?'http://localhost:3002':'http://localhost:3000',
    apiPort:pilot?8082:8080,pgPort:pilot?5434:5433,webPort:pilot?3002:3000,
    fabricPortOffset:pilot?14000:20000,
    networkRoot:`/home/kieup/agritrace-fabric/${instance}`,
    apiImage:`agritrace-local-fabric-api:${generation.slice(0,12)}`,
    webImage:`agritrace-local-fabric-web:${generation.slice(0,12)}`,
    createdAt:new Date().toISOString(),sourceHead:run('git',['rev-parse','HEAD']).trim(),
    sourceDiffSha256:createHash('sha256').update(run('git',['diff','--binary','HEAD'])).digest('hex'),
    authorizedOldTarget:ownership,oldApplicationImages:resources.map(r=>({service:r.Config.Labels['com.docker.compose.service'],id:r.Image})),
    destructiveResetCompleted:false};
  save(targetFile,receipt);
  const environment={POSTGRES_DB:'agri_trace',POSTGRES_USER:'agritrace',POSTGRES_PASSWORD:randomBytes(30).toString('hex'),
    POSTGRES_PORT:receipt.pgPort,API_PORT:receipt.apiPort,WEB_PORT:receipt.webPort,
    JWT_SECRET:randomBytes(48).toString('hex'),PLATFORM_SECRET_KEY:randomBytes(32).toString('base64'),
    IOT_INGEST_API_KEY:randomBytes(32).toString('hex'),
    HYBRID_WRITES_MODE:'OPEN',RATE_LIMIT_REQUESTS:100000,RATE_LIMIT_TTL_MS:60000,
    CORS_ORIGIN:receipt.publicOrigin,PUBLIC_TRACE_BASE_URL:`${receipt.publicOrigin}/trace`,
    NEXT_PUBLIC_API_BASE_URL:`http://localhost:${receipt.apiPort}/api`,NEXT_PUBLIC_TRACE_BASE_URL:`${receipt.publicOrigin}/trace`,
    ENTERPRISE_ONBOARDING_ENABLED:'true',ENTERPRISE_PAYMENTS_ENABLED:'false',CONSUMER_AUTH_ENABLED:'true',STAFF_APP_AUTH_ENABLED:'true',
    AGRITRACE_LOCAL_FABRIC_RECEIPT:targetFile,
    AGRITRACE_LOCAL_FABRIC_RUN:join(work,'run'),AGRITRACE_LOCAL_FABRIC_ASSETS:join(directory,'assets'),
    FABRIC_BINDINGS_CONFIG:join(work,'bindings-host.json')};
  writeFileSync(join(work,'private.env'),Object.entries(environment).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
  console.log(`Prepared ${pilot?'isolated pilot':'local application'} generation ${generation.slice(0,12)}; old data unchanged.`);
}

function network(action) {
  const t=target();
  assert.match(t.instance,/^agritrace-local-[a-f0-9]{12}$/);
  assert.equal(t.networkRoot,`/home/kieup/agritrace-fabric/${t.instance}`);
  if(!['down','clean'].includes(action))ensureWsl();
  if(action==='tune') {
    const result=run('wsl',['-d','Ubuntu','--','python3',`${wslPath(repository)}/scripts/demo/local-fabric-batching.py`,
      t.networkRoot,t.instance,String(t.fabricPortOffset)]);
    console.log(result.trim());return;
  }
  const args=['-d','Ubuntu','--','env',`AGRI_FABRIC_INSTANCE=${t.instance}`,`AGRI_FABRIC_ROOT=${t.networkRoot}`,
    `AGRI_FABRIC_PORT_OFFSET=${t.fabricPortOffset}`,'AGRI_FABRIC_BIND_ADDRESS=0.0.0.0',
    `CC_VERSION=local-${t.sourceHead.slice(0,12)}`,'AGRI_FABRIC_MEMORY=768m',
    'bash',`${wslPath(repository)}/blockchain/network/hybrid/hybrid-network.sh`,action];
  if(action==='up') {
    run('wsl',['-d','Ubuntu','--','mkdir','-p',`${t.networkRoot}/fabric-samples`]);
    for(const item of ['bin','config'])run('wsl',['-d','Ubuntu','--','cp','-a',`${wslPath(repository)}/blockchain/.fabric/fabric-samples/${item}`,`${t.networkRoot}/fabric-samples/`]);
  }
  if(action==='export')args.push(`${t.networkRoot}/export`);
  const log=join(work,'logs',`network-${action}.log`);
  const result=spawnSync('wsl',args,{cwd:repository,encoding:'utf8',maxBuffer:32*1024*1024,timeout:1200_000});
  writeFileSync(log,(result.stdout??'')+(result.stderr??''),{mode:0o600});
  assert.equal(result.status,0,`Fabric ${action} failed; inspect private log ${log}`);
  if(action==='export') {
    const identities=join(work,'identities');
    assert.equal(dirname(identities),work);
    assert.ok([directory,join(directory,'pilot')].includes(work),'Identity export must stay in the task runtime directory');
    if(existsSync(identities))rmSync(identities,{recursive:true});
    mkdirSync(identities,{recursive:true});
    run('wsl',['-d','Ubuntu','--','cp','-a',`${t.networkRoot}/export/.`,wslPath(identities)]);
    bindings(t,identities);
  }
  console.log(`Fabric ${action} completed for ${t.instance}.`);
}

function bindings(t,identities) {
  const digest=createHash('sha256').update(canonicalize(json(join(repository,'blockchain/chaincode/src/governance.json')))).digest('hex');
  // Ubuntu owns a native Docker daemon, separate from Docker Desktop. Connect
  // through its private WSL address; do not pretend their Docker networks overlap.
  const addresses=run('wsl',['-d','Ubuntu','--','hostname','-I']).trim().split(/\s+/);
  const address=addresses.find(ip=>/^172\./.test(ip));
  assert.ok(address,'WSL private IPv4 address missing');
  for(const mode of ['host','worker']) {
    const base=mode==='host'?identities.replaceAll('\\','/'):'/hosted-identities';
    const node={peerEndpoint:`${address}:${7051+t.fabricPortOffset}`,
      peerHostAlias:'peer0.org1.example.com',tlsCertPath:`${base}/tls/org1-peer-ca.crt`,mspId:'AgritraceMSP'};
    for(const role of ['relayer','controller','admin'])node[role]={certPath:`${base}/agritrace/${role}/signcerts/cert.pem`,keyDir:`${base}/agritrace/${role}/keystore`};
    save(join(work,`bindings-${mode}.json`),{version:1,bindings:[],platform:{network:t.instance,channelId:'agritrace',
      chaincodeName:'agritrace',contractName:'AgriTraceContract',writerAuthority:'agritrace-relayer-b',governanceDigest:digest,node}});
  }
}

function composeFile(t) {
  const escaped=p=>p.replaceAll('\\','/');
  const override={services:{
    api:{image:t.apiImage,labels:{'agritrace.local.generation':t.generation},environment:{
      PLATFORM_SECRET_KEY:'${PLATFORM_SECRET_KEY}',ENTERPRISE_ONBOARDING_ENABLED:'true',ENTERPRISE_PAYMENTS_ENABLED:'false',
      CONSUMER_AUTH_ENABLED:'true',STAFF_APP_AUTH_ENABLED:'true',FABRIC_ENABLED:'false',RATE_LIMIT_REQUESTS:'100000'}},
    worker:{image:t.apiImage,labels:{'agritrace.local.generation':t.generation,
      'agritrace.local.fabric.endpoint':json(join(work,'bindings-worker.json')).platform.node.peerEndpoint},environment:{FABRIC_ENABLED:'true',
      FABRIC_BINDINGS_CONFIG:'/hosted-config/bindings.json',FABRIC_WORKER_INTERVAL_MS:'500',FABRIC_WORKER_BATCH_SIZE:'50',
      FABRIC_MAX_RETRIES:'12',PLATFORM_SECRET_KEY:'${PLATFORM_SECRET_KEY}',ENTERPRISE_ONBOARDING_ENABLED:'true',
      ENTERPRISE_PAYMENTS_ENABLED:'false'},volumes:[
        `${escaped(join(work,'bindings-worker.json'))}:/hosted-config/bindings.json:ro`,
        `${escaped(join(work,'identities'))}:/hosted-identities:ro`]},
    'ledger-simulator':{profiles:['simulation']},
    web:{image:t.webImage,labels:{'agritrace.local.generation':t.generation}}}};
  const file=join(work,'compose.json');save(file,override);return file;
}

function compose(t,...args) {
  return docker('compose','--project-name',t.project,'--env-file',join(work,'private.env'),'-f',join(repository,'docker-compose.yml'),'-f',composeFile(t),...args);
}

function build(onlyApi=false) {
  const t=target();
  for(const [name,image] of [['api',t.apiImage],['web',t.webImage]]) {
    if(onlyApi&&name!=='api')continue;
    const source=sourceManifest(name);
    const args=['build','-t',image,'--label',`agritrace.local.source.sha256=${source.digest}`,
      '--label',`agritrace.local.generation=${t.generation}`,'-f',`apps/${name}/Dockerfile`];
    if(name==='web')args.push('--build-arg',`NEXT_PUBLIC_API_BASE_URL=http://localhost:${t.apiPort}/api`,
      '--build-arg',`NEXT_PUBLIC_TRACE_BASE_URL=${t.publicOrigin}/trace`,'--build-arg','NEXT_PUBLIC_MOCK_API=false');
    args.push('.');
    const result=spawnSync('docker',args,{cwd:repository,encoding:'utf8',maxBuffer:32*1024*1024,timeout:1800_000});
    const log=join(work,'logs',`build-${name}.log`);writeFileSync(log,(result.stdout??'')+(result.stderr??''));
    assert.equal(result.status,0,`${name} image build failed; inspect ${log}`);
    assert.equal(sourceManifest(name).digest,source.digest,'Build inputs changed during compilation; rebuild from a stable source');
    const built=JSON.parse(docker('image','inspect',image))[0];
    assert.equal(built.Config.Labels['agritrace.local.source.sha256'],source.digest);
    save(join(work,`build-${name}.json`),{generation:t.generation,service:name,imageId:built.Id,image,source,
      sourceHead:run('git',['rev-parse','HEAD']).trim(),builtAt:new Date().toISOString()});
    console.log(`Built ${name} image ${image}.`);
  }
}

function reset() {
  assert.equal(pilot,false,'Pilot never removes the application target');
  const t=assertLocalFabricReceipt(target(),repository);
  assert.equal(t.destructiveResetCompleted,false,'Already reset: resume this generation; never reset again implicitly');
  assert.ok(existsSync(join(directory,'pilot','run','pilot-verified.json')),'API/Worker/Fabric pilot must pass before discarding old data');
  const pilotVerification=json(join(directory,'pilot','run','verification.json'));
  assert.equal(pilotVerification.generation,json(join(directory,'pilot','target.json')).generation);
  assert.equal(pilotVerification.allChecksPassed,true,'Independent pilot verification must pass');
  assert.ok(pilotVerification.ledger.checked>0&&pilotVerification.ledger.checked===pilotVerification.ledger.valid,'Real VALID ledger read-back is required');
  const intentFile=join(work,'reset-intent.json');
  const pending=existsSync(intentFile)?json(intentFile):null;
  let owner;
  if(!pending){
    const resources=JSON.parse(docker('inspect',...['api','worker','web','postgres'].map(s=>`${LOCAL_PROJECT}-${s}-1`)));
    owner=assertOwnedLocalStack(resources,repository);
  }else owner={volume:`${LOCAL_PROJECT}_postgres-data`};
  const ownedNames=docker('ps','-aq','--filter',`label=com.docker.compose.project=${LOCAL_PROJECT}`).trim().split(/\s+/).filter(Boolean);
  const all=ownedNames.length?JSON.parse(docker('inspect',...ownedNames)):[];
  if(pending)remainingResetContainers(pending,t,all.map(c=>c.Id));
  const allowed=new Set(['api','worker','web','postgres','ledger-simulator']);
  for(const resource of all) {
    assert.equal(resource.Config.Labels['com.docker.compose.project'],LOCAL_PROJECT);
    assert.equal(resolve(resource.Config.Labels['com.docker.compose.project.working_dir']),repository);
    assert.ok(allowed.has(resource.Config.Labels['com.docker.compose.service']),'Unexpected service in old project');
  }
  const volumeExists=docker('volume','ls','-q','--filter',`name=${owner.volume}`).trim().split(/\s+/).includes(owner.volume);
  if(volumeExists){
    const volume=JSON.parse(docker('volume','inspect',owner.volume))[0];
    assert.equal(volume.Labels['com.docker.compose.project'],LOCAL_PROJECT,'Wrong DB-volume owner');
  }
  if(!pending){
    assert.ok(volumeExists,'The original data volume must exist before the initial reset intent');
    const oldLedger=docker('exec',`${LOCAL_PROJECT}-postgres-1`,'psql','-U','agritrace','-d','agri_trace','-At','-c',
    "SELECT (SELECT count(*) FROM blockchain_proof)::text || ':' || (SELECT count(*) FROM fabric_network_binding WHERE network <> 'simulated-ledger')::text").trim();
    assert.equal(oldLedger,'0:0','Old target has external ledger history: reconcile its owned network before replacement');
    save(intentFile,{generation:t.generation,backup:null,retainedPreviousData:false,
      containers:all.map(r=>r.Name),containerIds:all.map(r=>r.Id),volume:owner.volume,at:new Date().toISOString()});
  }
  if(ownedNames.length)docker('rm','-f',...ownedNames);
  if(volumeExists)docker('volume','rm',owner.volume);
  t.destructiveResetCompleted=true;t.resetAt=new Date().toISOString();save(targetFile,t);
  console.log('Removed the verified local application containers and database volume; no backup created.');
}

function start() {
  const t=target();
  if(!pilot)assert.ok(t.destructiveResetCompleted,'Explicit reset receipt required');
  network('start');
  assert.ok(existsSync(join(work,'identities')),'Export Fabric identities before starting the application');
  bindings(t,join(work,'identities'));
  compose(t,'up','-d','--wait','--wait-timeout','180','--no-build','postgres','api','worker','web');
  console.log(`Started ${t.project}; simulator excluded; Fabric network ${t.instance}.`);
}

function copyPilotImages() {
  const t=target();const main=json(join(directory,'target.json'));
  docker('tag',main.apiImage,t.apiImage);docker('tag',main.webImage,t.webImage);
  for(const service of ['api','web'])if(existsSync(join(directory,`build-${service}.json`)))save(join(work,`build-${service}.json`),{
    ...json(join(directory,`build-${service}.json`)),generation:t.generation,image:service==='api'?t.apiImage:t.webImage,pinnedFromGeneration:main.generation});
  console.log('Pinned pilot images to the same application builds.');
}

function seed() {
  const t=target();
  const result=spawnSync(process.execPath,[`--env-file=${join(work,'private.env')}`,
    'scripts/demo/comprehensive-seed.mjs',...(pilot?['--pilot']:[])],{cwd:repository,stdio:'inherit'});
  process.exitCode=result.status??1;
}

function verify() {
  const result=spawnSync(process.execPath,[`--env-file=${join(work,'private.env')}`,
    'scripts/demo/verify-local-fabric.mjs',...(pilot?['--pilot']:[])],{cwd:repository,stdio:'inherit'});
  process.exitCode=result.status??1;
}

function verifyBrowser() {
  assert.equal(pilot,false,'Browser verification targets the application origin');
  const flags=['--business-only','--public-only','--qr-only'].filter(flag=>process.argv.includes(flag));
  assert.ok(flags.length<=1);
  const result=spawnSync(process.execPath,[`--env-file=${join(work,'private.env')}`,
    'scripts/demo/verify-local-fabric-browser.mjs',...flags],{cwd:repository,stdio:'inherit'});
  process.exitCode=result.status??1;
}

function status() {
  const t=target();console.log(JSON.stringify({project:t.project,generation:t.generation,instance:t.instance,
    reset:t.destructiveResetCompleted,origin:t.publicOrigin,apiPort:t.apiPort,pgPort:t.pgPort}));
}

const action=process.argv[2];
try {
  if(action==='prepare')initialize();
  else if(action==='build')build();
  else if(action==='build-api')build(true);
  else if(action==='pilot-images')copyPilotImages();
  else if(action==='network')network(process.argv[3]);
  else if(action==='reset')reset();
  else if(action==='start')start();
  else if(action==='seed')seed();
  else if(action==='verify')verify();
  else if(action==='browser')verifyBrowser();
  else if(action==='status')status();
  else throw new Error('Use prepare | build | build-api | pilot-images | network <up|deploy|tune|export|start|down|clean> | reset | start | seed | verify | browser | status [--pilot]');
} catch(error) {
  // Do not include subprocess arguments, environment or SQL payloads in public output.
  console.error(error.code?'Operator subprocess failed; inspect the private stage log.':error.message);
  process.exitCode=1;
}
