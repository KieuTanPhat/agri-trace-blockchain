// Explicitly authorized local fresh install. No dump, backup or production target.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {assertFruitTarget} from './fresh-fruit-target.mjs';
import {acquireSeedLock} from './seed-recovery.mjs';
const root=resolve(new URL('../../',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
process.chdir(root);
const dir=resolve('.codex/fruit-dataset');mkdirSync(dir,{recursive:true});
const docker=(args,input)=>execFileSync('docker',args,{encoding:'utf8',input,stdio:['pipe','pipe','pipe'],maxBuffer:20*1024*1024});
const [api,pg]=JSON.parse(docker(['inspect','agri-trace-demo-local-api-1','agri-trace-demo-local-postgres-1']));
const env=assertFruitTarget(api,pg,root);
const branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim();assert.equal(branch,'feature/mobile-apps-backend');
const assets=JSON.parse(readFileSync('.codex/fruit-assets/manifest.json','utf8'));
for(const a of assets.photos)assert.equal(createHash('sha256').update(readFileSync(resolve('.codex/fruit-assets',a.file))).digest('hex'),a.sha256);
for(let i=1;i<=3;i++)assert.ok(readFileSync(`.codex/fruit-assets/land-${i}.jpg`).length>100);
const sql=(text,db='agri_trace')=>docker(['exec','-i',pg.Name.slice(1),'sh','-c',`exec psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${db}`],text);
assert.equal(sql('SELECT current_database();').trim(),'agri_trace');
if(sql("SELECT to_regclass('public.fabric_network_binding') IS NOT NULL;").trim()==='t') {
  assert.equal(sql("SELECT count(*) FROM fabric_network_binding WHERE network <> 'simulated-ledger';").trim(),'0','Real Fabric bindings prohibit this local reset');
  assert.equal(sql('SELECT count(*) FROM blockchain_proof;').trim(),'0','Ledger receipts prohibit this local reset');
}
console.log('Verified exact local DB/project/checkout, migration source and all prepared assets.');
if(!process.argv.includes('--replace')&&!process.argv.includes('--resume'))process.exit(0);
const lock=acquireSeedLock(resolve(dir,'operator.lock'));
try {
  const pgEnv=Object.fromEntries(pg.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
  const settings={...env,POSTGRES_DB:'agri_trace',POSTGRES_PORT:'5433',POSTGRES_USER:pgEnv.POSTGRES_USER,POSTGRES_PASSWORD:pgEnv.POSTGRES_PASSWORD,
    API_PORT:'8080',WEB_PORT:'3000',PLATFORM_SECRET_KEY:env.PLATFORM_SECRET_KEY||randomBytes(32).toString('base64'),PLATFORM_MFA_MODE:'OPTIONAL',
    CORS_ORIGIN:'http://localhost:3000,http://localhost:8082,http://192.168.1.2:8082,http://192.168.1.2:3000',
    HYBRID_WRITES_MODE:'OPEN',FABRIC_ENABLED:'false',PUBLIC_TRACE_BASE_URL:'http://localhost:3000/trace',RATE_LIMIT_REQUESTS:'3000'};
  // A reused PostgreSQL volume can have a different password from its container
  // configuration. Never rotate the shared role: other databases use it.
  const appCredentialsPath=resolve(dir,'db-role.json');
  const appCredentials=existsSync(appCredentialsPath)?JSON.parse(readFileSync(appCredentialsPath,'utf8')):{user:'fruit_runtime',password:randomBytes(32).toString('base64url')};
  writeFileSync(appCredentialsPath,JSON.stringify(appCredentials),{mode:0o600});
  const appConnection=new URL(env.DATABASE_URL);
  appConnection.username=appCredentials.user;appConnection.password=appCredentials.password;
  const envPath=resolve(dir,'runtime.env');
  writeFileSync(envPath,Object.entries(settings).filter(([k])=>!['DATABASE_URL','HOSTNAME','PATH','NODE_VERSION','YARN_VERSION','NODE_ENV','PORT'].includes(k)).map(([k,v])=>`${k}=${v}`).join('\n'),{mode:0o600});
  if(process.platform==='win32')execFileSync('icacls',[dir,'/inheritance:r','/grant:r',`${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`],{stdio:'ignore'});
  const override={services:{api:{image:'agritrace-mobile-backend-api:fruit',environment:{DATABASE_URL:appConnection.href,PLATFORM_SECRET_KEY:settings.PLATFORM_SECRET_KEY,PLATFORM_MFA_MODE:'OPTIONAL',ENTERPRISE_ONBOARDING_ENABLED:'true',STAFF_APP_AUTH_ENABLED:'true'}},worker:{image:'agritrace-mobile-backend-api:fruit',environment:{DATABASE_URL:appConnection.href,PLATFORM_SECRET_KEY:settings.PLATFORM_SECRET_KEY,ENTERPRISE_ONBOARDING_ENABLED:'true'}},'ledger-simulator':{image:'agritrace-mobile-backend-api:fruit',environment:{DATABASE_URL:appConnection.href}},web:{image:'agritrace-mobile-backend-web:fruit'}}};
  override.services.api.environment.CONSUMER_AUTH_ENABLED='true';
  const overridePath=resolve(dir,'compose.override.json');writeFileSync(overridePath,JSON.stringify(override),{mode:0o600});
  const loopbackPath=resolve(dir,'loopback.override.yml');
  writeFileSync(loopbackPath,'services:\n  postgres:\n    ports: !override\n      - "127.0.0.1:5433:5432"\n');
  const compose=['compose','--env-file',envPath,'-p','agri-trace-demo-local','-f','docker-compose.yml','-f',overridePath,'-f',loopbackPath];
  if(process.argv.includes('--replace')) {
    assert.ok(process.argv.includes('--no-backup'),'Explicit --no-backup acknowledgement required');
    assert.ok(!existsSync(resolve(dir,'reset.json')),'Already reset: use --resume, never implicitly reset again');
    docker(['stop','agri-trace-demo-local-web-1','agri-trace-demo-local-api-1','agri-trace-demo-local-worker-1','agri-trace-demo-local-ledger-simulator-1']);
    // Fixed literal target; no database names are interpolated from user input.
    sql('DROP DATABASE agri_trace WITH (FORCE);\nCREATE DATABASE agri_trace;','postgres');
    writeFileSync(resolve(dir,'reset.json'),JSON.stringify({database:'agri_trace',at:new Date().toISOString(),backup:false}));
    console.log('Authorized old local database removed without backup; fresh database created.');
  }else assert.ok(existsSync(resolve(dir,'reset.json')),'Resume requires reset receipt');
  assert.match(appCredentials.password,/^[A-Za-z0-9_-]+$/);
  assert.equal(appCredentials.user,'fruit_runtime');
  if(sql("SELECT count(*) FROM pg_roles WHERE rolname='fruit_runtime';",'postgres').trim()==='0')sql(`CREATE ROLE fruit_runtime LOGIN PASSWORD '${appCredentials.password}';`,'postgres');
  sql('ALTER DATABASE agri_trace OWNER TO fruit_runtime;','postgres');
  docker([...compose,'up','-d','--no-build','api','ledger-simulator']);
  for(let i=0;i<60;i++) {
    try {if((await fetch('http://127.0.0.1:8080/api/health')).ok)break;}catch{}
    if(i===59)throw new Error('API health timeout');
    await new Promise(r=>setTimeout(r,1000));
  }
  const connection=new URL(appConnection);connection.hostname='127.0.0.1';connection.port='5433';
  const seedEnv={...process.env,DATABASE_URL:connection.href,FABRIC_ENABLED:'false',PUBLIC_TRACE_BASE_URL:'http://localhost:3000/trace',AGRITRACE_LOCAL_SEED_TARGET:'agri-trace-demo-local/agri_trace'};
  for(const script of ['full-seed.mjs','verify-seed.mjs']) {
    const child=spawn(process.execPath,[`scripts/demo/${script}`,...(script==='verify-seed.mjs'?['--fresh']:[])],{env:seedEnv,stdio:'inherit'});
    lock.update(child.pid);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    lock.update(null);
    assert.equal(code,0,`${script} failed; resume preserves original command bodies and keys`);
  }
  docker([...compose,'up','-d','--no-build','worker','web']);
  console.log('Fresh dataset verified. Web and Worker started. Local ledger remains explicitly simulated.');
}finally{lock.release();}
