import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOwnedLocalStack, assertLocalFabricReceipt, remainingResetContainers, LOCAL_PROJECT, TARGET_PROTOCOL } from './local-fabric-target.mjs';

const repository=process.cwd();
const resources=()=>['api','worker','web','postgres'].map(service=>({Name:`/${LOCAL_PROJECT}-${service}-1`,
  Config:{Labels:{'com.docker.compose.project':LOCAL_PROJECT,'com.docker.compose.service':service,
    'com.docker.compose.project.working_dir':repository},Env:['POSTGRES_DB=agri_trace']},
  Mounts:service==='postgres'?[{Type:'volume',Name:`${LOCAL_PROJECT}_postgres-data`,Destination:'/var/lib/postgresql'}]:[]}));
test('accepts exactly the owned current local application and PG18 volume',()=>{
  assert.equal(assertOwnedLocalStack(resources(),repository).volume,`${LOCAL_PROJECT}_postgres-data`);
});
for(const [name,mutate] of [
  ['another Compose owner',r=>r[0].Config.Labels['com.docker.compose.project']='agritrace-prod'],
  ['another checkout',r=>r[1].Config.Labels['com.docker.compose.project.working_dir']=repository+'/other'],
  ['a shared test volume',r=>r[3].Mounts[0].Name='agritrace-chainowner-test'],
  ['another DB',r=>r[3].Config.Env=['POSTGRES_DB=agri_trace_prod']],
  ['a missing service',r=>r.pop()],
  ['a substituted container',r=>r[0].Name='/unrelated-api-1'],
])test(`refuses ${name} before deletion`,()=>{const r=resources();mutate(r);assert.throws(()=>assertOwnedLocalStack(r,repository));});
const receipt=()=>({protocol:TARGET_PROTOCOL,project:LOCAL_PROJECT,repository,generation:'a'.repeat(32),
 backup:null,production:false,instance:'agritrace-local-aaaaaaaaaaaa',network:'agritrace-local-aaaaaaaaaaaa-network',publicOrigin:'http://localhost:3000'});
test('a checkpoint cannot resume into another generation',()=>{
  assert.throws(()=>assertLocalFabricReceipt(receipt(),repository,'b'.repeat(32)));
});
test('production and nonlocal origins are rejected',()=>{
  assert.throws(()=>assertLocalFabricReceipt({...receipt(),production:true},repository));
  assert.throws(()=>assertLocalFabricReceipt({...receipt(),publicOrigin:'https://agritrace.dev'},repository));
});
const intent=()=>({generation:receipt().generation,backup:null,volume:`${LOCAL_PROJECT}_postgres-data`,containerIds:['1','2','3','4'].map(x=>x.repeat(64))});
test('reset recovery continues after some authorized containers were already removed',()=>{
  assert.deepEqual(remainingResetContainers(intent(),receipt(),['3'.repeat(64)]),['3'.repeat(64)]);
  assert.deepEqual(remainingResetContainers(intent(),receipt(),[]),[]);
});
test('reset recovery never removes a replacement or an unrelated container',()=>{
  assert.throws(()=>remainingResetContainers(intent(),receipt(),['5'.repeat(64)]));
  assert.throws(()=>remainingResetContainers({...intent(),generation:'b'.repeat(32)},receipt(),[]));
});
