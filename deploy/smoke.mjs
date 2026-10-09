import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.mjs';
import { UAT_FIXTURE, UAT_ROLES } from './fixtures.mjs';

const {values} = parseArgs({options: {env: {type: 'string', default: '.uat/.env.uat'}, 'expect-proof': {type: 'string', default: 'PENDING'}}});
let config;
let accounts;
const tokens = {};
const credentials = {};

function refreshCookie(response) {
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.match(cookie ?? '', /^agritrace_refresh=[A-Za-z0-9_-]+$/, 'Refresh cookie missing');
  return cookie;
}

async function request(route, role, body, expected = body === undefined ? 200 : 201, key = body === undefined ? undefined : randomUUID(), options = {}) {
  const response = await fetch(`${config.PUBLIC_ORIGIN}/api${route}`, {
    method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15_000),
    headers: {...(role ? {Authorization: `Bearer ${tokens[role]}`} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...(key ? {'Idempotency-Key': key} : {}), ...(options.cookie ? {Cookie: options.cookie} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  // Never include request bodies, responses containing tokens or credentials.
  assert.equal(response.status, expected, `Unexpected HTTP status at ${route}`);
  if (options.onCookie) options.onCookie(refreshCookie(response));
  const envelope = await response.json();
  return envelope.data;
}

try {
  config = loadConfig(values.env);
  assert.ok(['PENDING', 'VERIFIED'].includes(values['expect-proof']), 'Unsupported proof expectation');
  try {accounts = JSON.parse(readFileSync(config.UAT_ACCOUNTS_FILE, 'utf8'));}
  catch {throw new Error('Cannot read UAT accounts; credentials withheld');}
  assert.ok(Array.isArray(accounts) && accounts.length === UAT_ROLES.length, 'UAT accounts are incomplete');
  assert.equal((await fetch(`${config.PUBLIC_ORIGIN}/login`)).status, 200, 'Public login page failed to render');
  assert.equal((await fetch(`${config.PUBLIC_ORIGIN}/api/docs`)).status, 404);
  await request('/health');
  for (const role of UAT_ROLES) {
    const account = accounts.find(item => item.role === role);
    assert.ok(account, 'Required UAT account is missing');
    const session = await request('/auth/login', undefined, {email: account.email, password: account.password}, 201, undefined, {onCookie: (cookie) => {credentials[role] = cookie;}});
    tokens[role] = session.accessToken;
    assert.equal((await request('/auth/me', role)).role.code, role);
  }
  await request('/organizations', 'AUDITOR', {name: 'Must be rejected', type: 'FARM'}, 403);
  const cycleInput = {farmId: UAT_FIXTURE.farmId, plotId: UAT_FIXTURE.plotId, productId: UAT_FIXTURE.productId, cycleCode: `UAT-${randomUUID()}`, maxHarvestQuantity: 10, harvestUnit: 'kg'};
  const key = randomUUID();
  const cycle = await request('/production-cycles', 'FARM_STAFF', cycleInput, 201, key);
  assert.equal((await request('/production-cycles', 'FARM_STAFF', cycleInput, 201, key)).id, cycle.id);
  await request(`/production-cycles/${cycle.id}/plant`, 'FARM_STAFF', {version: 0, plantedAt: new Date(Date.now() - 60_000).toISOString()});
  await request(`/production-cycles/${cycle.id}/care`, 'FARM_STAFF', {version: 1, careType: 'WATERING', eventTime: new Date().toISOString()});
  const lots = [];
  for (let index = 0; index < 2; index++) {
    const harvest = await request(`/production-cycles/${cycle.id}/harvests`, 'FARM_STAFF', {quantity: 2, unit: 'kg', harvestTime: new Date().toISOString()});
    lots.push(harvest.lot.id);
    const shipment = await request('/shipments', 'FARM_STAFF', {lotId: harvest.lot.id, transporterOrgId: UAT_FIXTURE.organizations.TRANSPORTER.id, retailerOrgId: UAT_FIXTURE.organizations.RETAILER.id, origin: 'UAT farm', destination: 'UAT retailer'});
    const versions = async () => {
      const current = await request(`/shipments/${shipment.id}`, 'TRANSPORTER');
      const lot = await request(`/lots/${harvest.lot.id}`, 'FARM_STAFF');
      return {version: current.version, lotVersion: lot.version};
    };
    await request(`/shipments/${shipment.id}/start`, 'TRANSPORTER', await versions());
    await request(`/shipments/${shipment.id}/arrive`, 'TRANSPORTER', await versions());
    if (index === 0) await request(`/shipments/${shipment.id}/receive`, 'RETAILER', {...await versions(), receivedQuantity: 2});
    else await request(`/shipments/${shipment.id}/reject`, 'RETAILER', {...await versions(), reason: 'UAT rejection scenario'});
    const trace = await request(`/public/trace/${harvest.traceQr.traceToken}`);
    assert.equal(trace.lotId, harvest.lot.id);
    if (values['expect-proof'] === 'PENDING') assert.equal(trace.proofStatus, 'PENDING');
    else {
      const deadline = Date.now() + 180_000;
      let proof = trace;
      while (proof.proofStatus !== 'VERIFIED' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        proof = await request(`/public/trace/${harvest.traceQr.traceToken}`);
      }
      assert.equal(proof.proofStatus, 'VERIFIED');
    }
    assert.equal((await fetch(`${config.PUBLIC_ORIGIN}/trace/${harvest.traceQr.traceToken}`)).status, 200, 'Public QR page failed to render');
  }
  let rotatedCookie;
  const refreshed = await request('/auth/refresh', undefined, {}, 201, undefined, {cookie: credentials.SYSTEM_ADMIN, onCookie: (cookie) => {rotatedCookie = cookie;}});
  assert.ok(refreshed.accessToken && rotatedCookie);
  await request('/auth/logout', undefined, {}, 201, undefined, {cookie: rotatedCookie});
  await request('/auth/refresh', undefined, {}, 401, undefined, {cookie: rotatedCookie});
  console.log(JSON.stringify({result: 'passed', roles: UAT_ROLES, cycleId: cycle.id, lotIds: lots, proof: values['expect-proof'], flows: ['login/me', 'RBAC rejection', 'idempotency replay', 'two harvests', 'shipments receive/reject', 'public QR', 'refresh/logout']}));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'UAT smoke failed');
  process.exitCode = 1;
}
