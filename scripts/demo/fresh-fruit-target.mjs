import assert from 'node:assert/strict';
import { resolve } from 'node:path';
export function assertFruitTarget(api,pg,root) {
  for(const c of [api,pg]) {
    assert.equal(c.Config.Labels['com.docker.compose.project'],'agri-trace-demo-local','Wrong Compose project');
    assert.equal(resolve(c.Config.Labels['com.docker.compose.project.working_dir']),resolve(root),'Wrong checkout');
  }
  assert.equal(api.Name,'/agri-trace-demo-local-api-1');
  assert.equal(pg.Name,'/agri-trace-demo-local-postgres-1');
  const env=Object.fromEntries(api.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
  const db=new URL(env.DATABASE_URL);
  assert.equal(db.hostname,'postgres');assert.equal(db.pathname,'/agri_trace');
  assert.equal(env.FABRIC_ENABLED,'false','This operator only resets the authorized local simulator stack');
  assert.ok(pg.Mounts.some(m=>m.Name==='agri-trace-demo-local_postgres-data'));
  assert.ok(pg.HostConfig.PortBindings['5432/tcp'].some(p=>p.HostPort==='5433'&&p.HostIp==='127.0.0.1'));
  return env;
}
