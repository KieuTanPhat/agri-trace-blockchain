import assert from 'node:assert/strict';
import test from 'node:test';
import {deploymentTarget,requireImage} from './publish.mjs';
const env={CD_ENVIRONMENT:'development',GITHUB_REF:'refs/heads/dev',PUBLIC_ORIGIN:'https://nongtrace.site',GITHUB_SHA:'a'.repeat(40)};
test('same source SHA has separate origin, branch and tag identity',()=>{
  const dev=deploymentTarget(env);
  const prod=deploymentTarget({...env,CD_ENVIRONMENT:'production',GITHUB_REF:'refs/heads/main',PUBLIC_ORIGIN:'https://agritrace.dev',CD_PROJECT:'agri-trace-uat'});
  assert.equal(dev.prefix,'dev');assert.equal(dev.profile,'light');assert.equal(prod.prefix,'prod');assert.equal(prod.profile,'fabric');
  assert.notEqual(dev.origin,prod.origin);
});
test('wrong branch, domain, project or production light profile cannot publish',()=>{
  for(const change of [{CD_ENVIRONMENT:'uat'},{GITHUB_REF:'refs/heads/main'},{PUBLIC_ORIGIN:'https://agritrace.dev'},
    {CD_PROJECT:'agri-trace-uat'},{GITHUB_SHA:'tag'}])assert.throws(()=>deploymentTarget({...env,...change}));
  assert.throws(()=>deploymentTarget({...env,CD_ENVIRONMENT:'production',GITHUB_REF:'refs/heads/main',PUBLIC_ORIGIN:'https://agritrace.dev',CD_PROFILE:'light'}));
});
test('existing immutable image cannot be reused with different deployment labels',()=>{
  const labels={'agritrace.environment':'development','agritrace.public-origin':'https://nongtrace.site'};
  requireImage({Config:{User:'1000',Labels:labels}},labels);
  assert.throws(()=>requireImage({Config:{User:'1000',Labels:{...labels,'agritrace.environment':'production'}}},labels));
  assert.throws(()=>requireImage({Config:{User:'0:0',Labels:labels}},labels));
});
