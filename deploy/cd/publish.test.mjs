import assert from 'node:assert/strict';
import test from 'node:test';
import {deploymentTarget,requireImage} from './publish.mjs';
const env={CD_ENVIRONMENT:'production',GITHUB_REF:'refs/heads/main',PUBLIC_ORIGIN:'https://agritrace.dev',GITHUB_SHA:'a'.repeat(40)};
test('production publishes only main with Fabric and may retain adopted PGDATA',()=>{
  const prod=deploymentTarget(env);
  assert.equal(prod.prefix,'prod');assert.equal(prod.profile,'fabric');assert.equal(prod.project,'agritrace-prod');
  assert.equal(deploymentTarget({...env,CD_PROJECT:'agri-trace-uat'}).project,'agri-trace-uat');
});
test('wrong branch, domain, project or production light profile cannot publish',()=>{
  for(const change of [{CD_ENVIRONMENT:'development'},{CD_ENVIRONMENT:'uat'},{GITHUB_REF:'refs/heads/dev'},
    {PUBLIC_ORIGIN:'https://nongtrace.site'},{CD_PROJECT:'agritrace-dev'},{GITHUB_SHA:'tag'},{CD_PROFILE:'light'}])
    assert.throws(()=>deploymentTarget({...env,...change}));
});
test('existing immutable image cannot be reused with different deployment labels',()=>{
  const labels={'agritrace.environment':'production','agritrace.public-origin':'https://agritrace.dev'};
  requireImage({Config:{User:'1000',Labels:labels}},labels);
  assert.throws(()=>requireImage({Config:{User:'1000',Labels:{...labels,'agritrace.environment':'development'}}},labels));
  assert.throws(()=>requireImage({Config:{User:'0:0',Labels:labels}},labels));
});
