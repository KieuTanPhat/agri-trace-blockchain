import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFruitTarget} from './fresh-fruit-target.mjs';
const root=process.cwd();
function fixture(){
  const labels={'com.docker.compose.project':'agri-trace-demo-local','com.docker.compose.project.working_dir':root};
  return [{Name:'/agri-trace-demo-local-api-1',Config:{Labels:{...labels},Env:['DATABASE_URL=postgresql://user@postgres/agri_trace','FABRIC_ENABLED=false']}},
    {Name:'/agri-trace-demo-local-postgres-1',Config:{Labels:{...labels}},Mounts:[{Name:'agri-trace-demo-local_postgres-data'}],HostConfig:{PortBindings:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'5433'}]}}}];
}
test('accepts only the explicitly authorized local target',()=>{const[a,p]=fixture();assert.ok(assertFruitTarget(a,p,root));});
for(const [name,change] of [
  ['other project',(a,p)=>p.Config.Labels['com.docker.compose.project']='production'],
  ['other database',(a)=>a.Config.Env[0]='DATABASE_URL=postgresql://user@postgres/other'],
  ['real Fabric',(a)=>a.Config.Env[1]='FABRIC_ENABLED=true'],
  ['other checkout',(a)=>a.Config.Labels['com.docker.compose.project.working_dir']=root+'/other'],
  ['other port',(a,p)=>p.HostConfig.PortBindings['5432/tcp'][0].HostPort='15438'],
])test(`refuses ${name}`,()=>{const[a,p]=fixture();change(a,p);assert.throws(()=>assertFruitTarget(a,p,root));});
