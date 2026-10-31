import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowPlan, assertWorkflowTarget } from './ui-workflow-plan.mjs';
test('100 clearly marked products span all producer/processor owners and all five organization types',()=>{
 const p=workflowPlan();assert.deepEqual(p,workflowPlan());assert.equal(p.organizations.length,30);assert.equal(p.products.length,100);
 assert.equal(new Set(p.organizations.map(o=>o.type)).size,5);assert.equal(new Set(p.products.map(p=>p.key)).size,100);
 assert.equal(p.products.filter(p=>p.processed).length,30);assert.equal(new Set(p.products.map(p=>p.owner)).size,18);
 for(const product of p.products){assert.match(product.name,/^\[DEMO-100\]/);const owner=p.organizations.find(o=>o.key===product.owner);assert.equal(owner.type,product.processed?'PROCESSOR':'FARM');}
});
test('additive seed target refuses remote endpoints, alternate sockets, other DBs and production',()=>{
 const env={DATABASE_URL:'postgresql://fixture@localhost:5432/agri_trace_ui_test',AGRI_UI_WORKFLOW_API:'http://localhost:8080/api',AGRI_UI_WORKFLOW_CONFIRM:'agri_trace_ui_test'};
 assert.equal(assertWorkflowTarget(env).database,'agri_trace_ui_test');
 for(const change of [{NODE_ENV:'production'},{DATABASE_URL:'postgresql://fixture@remote.invalid/agri_trace_ui_test'},{DATABASE_URL:env.DATABASE_URL+'?host=remote.invalid'},{AGRI_UI_WORKFLOW_CONFIRM:''},{AGRI_UI_WORKFLOW_API:'https://agritrace.dev/api'},{AGRI_UI_WORKFLOW_API:'http://localhost:8080/not-api'},{DATABASE_URL:'postgresql://fixture@localhost:5432/another_test'}])assert.throws(()=>assertWorkflowTarget({...env,...change}));
});
