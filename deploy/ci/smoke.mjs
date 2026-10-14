import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const ROLES = ['SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR'];

function refreshCookie(response, previous = '') {
  const cookies = new Map(previous.split('; ').filter(Boolean).map(pair => pair.split('=')));
  for (const header of response.headers.getSetCookie()) {
    const [name, value] = header.split(';', 1)[0].split('=');
    if (/Max-Age=0(?:;|$)/i.test(header)) cookies.delete(name);
    else cookies.set(name, value);
  }
  const sessionId = cookies.get('agritrace_session');
  assert.match(sessionId ?? '', /^[a-f0-9-]{36}$/, 'Session cookie missing');
  assert.match(cookies.get(`agritrace_refresh_${sessionId}`) ?? '', /^[A-Za-z0-9_-]+$/, 'Refresh cookie missing');
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** Polls the public proxy until it routes to the API; a freshly started container can lag its healthy dependencies. */
export async function waitForEdge(origin, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (response.status === 200) return;
      last = `HTTP ${response.status}`;
    } catch (error) { last = error?.cause?.code ?? error?.name ?? 'error'; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`The public proxy did not become ready (${last})`);
}

/**
 * Business and session smoke over the public proxy. `fixture` is what provision.mjs created:
 * { accounts: [{role, email, password}], chainId, farmId, plotId, productId, organizations: {ROLE: id} }.
 * `full` adds the two-harvest shipment/consent flow and the refresh/logout rotation; the post-restore
 * run only proves that restored accounts, sessions and QR data still work.
 */
export async function runSmoke({ origin, fixture, full = true, expectedLots = [], expectedTraceTokens = [] }) {
  const tokens = {};
  const cookies = {};
  async function request(route, role, body, expected = body === undefined ? 200 : 201, key = body === undefined ? undefined : randomUUID(), options = {}) {
    const response = await fetch(`${origin}/api${route}`, {
      method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15_000),
      headers: {
        ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Never include request bodies or responses that contain tokens or credentials.
    assert.equal(response.status, expected, `Unexpected HTTP status at ${route}`);
    if (options.onCookie) options.onCookie(refreshCookie(response, options.cookie));
    return (await response.json()).data;
  }

  assert.equal((await fetch(`${origin}/login`)).status, 200, 'Public login page failed to render');
  assert.equal((await fetch(`${origin}/api/docs`)).status, 404, 'API documentation must stay hidden at the edge');
  await request('/health');
  const roles = full ? ROLES : ['SYSTEM_ADMIN', 'FARM_STAFF'];
  for (const role of roles) {
    const account = fixture.accounts.find(item => item.role === role);
    assert.ok(account, 'Required account is missing');
    const session = await request('/auth/login', undefined, { email: account.email, password: account.password }, 201, undefined,
      { onCookie: cookie => { cookies[role] = cookie; } });
    tokens[role] = session.accessToken;
    assert.equal((await request('/auth/me', role)).role.code, role);
  }
  if (!full) {
    for (const lotId of expectedLots) {
      const lot = await request(`/lots/${lotId}`, 'FARM_STAFF');
      assert.equal(lot.lotId, lotId, 'A restored lot is unavailable');
    }
    for (const token of expectedTraceTokens) {
      assert.equal((await request(`/public/trace/${token}`)).proofStatus, 'PENDING', 'A restored public QR must still resolve as PENDING');
    }
    return { result: 'passed', roles, restoredLots: expectedLots.length, restoredTokens: expectedTraceTokens.length };
  }

  await request('/organizations', 'AUDITOR', { name: 'Must be rejected', type: 'FARM' }, 403);
  const cycleInput = { chainId: fixture.chainId, farmId: fixture.farmId, plotId: fixture.plotId, productId: fixture.productId,
    cycleCode: `CI-${randomUUID()}`, maxHarvestQuantity: 10, harvestUnit: 'kg' };
  const key = randomUUID();
  const cycle = await request('/production-cycles', 'FARM_STAFF', cycleInput, 201, key);
  assert.equal((await request('/production-cycles', 'FARM_STAFF', cycleInput, 201, key)).id, cycle.id, 'Idempotency replay must preserve the cycle');
  await request(`/production-cycles/${cycle.id}/plant`, 'FARM_STAFF', { version: 0, plantedAt: new Date(Date.now() - 60_000).toISOString() });
  await request(`/production-cycles/${cycle.id}/care`, 'FARM_STAFF', { version: 1, careType: 'WATERING', eventTime: new Date().toISOString() });
  const lots = [];
  const tokensByLot = [];
  for (let index = 0; index < 2; index++) {
    const harvest = await request(`/production-cycles/${cycle.id}/harvests`, 'FARM_STAFF', { quantity: 2, unit: 'kg', harvestTime: new Date().toISOString() });
    lots.push(harvest.lot.id);
    tokensByLot.push(harvest.traceQr.traceToken);
    // A chain lot ships only through a finalized ShipmentPlan that all three parties accepted.
    const plans = `/supply-chains/${fixture.chainId}/shipment-plans`;
    const plan = await request(plans, 'FARM_STAFF', { lotId: harvest.lot.id, transporterOrgId: fixture.organizations.TRANSPORTER,
      retailerOrgId: fixture.organizations.RETAILER, quantity: '2.000', unit: 'kg', origin: 'CI farm', destination: 'CI retailer' });
    for (const [party, role] of [['PRODUCER', 'FARM_STAFF'], ['TRANSPORTER', 'TRANSPORTER'], ['RETAILER', 'RETAILER']]) {
      await request(`${plans}/${plan.id}/accept`, role, { party, revision: plan.currentRevision, payloadDigest: plan.current.payloadDigest });
    }
    const finalized = await request(`${plans}/${plan.id}/finalize`, 'FARM_STAFF', { version: plan.version });
    const versions = async () => {
      const current = await request(`/shipments/${finalized.shipmentId}`, 'TRANSPORTER');
      const lot = await request(`/lots/${harvest.lot.id}`, 'FARM_STAFF');
      return { version: current.version, lotVersion: lot.version };
    };
    await request(`/shipments/${finalized.shipmentId}/start`, 'TRANSPORTER', await versions());
    await request(`/shipments/${finalized.shipmentId}/arrive`, 'TRANSPORTER', await versions());
    if (index === 0) await request(`/shipments/${finalized.shipmentId}/receive`, 'RETAILER', { ...await versions(), receivedQuantity: 2 });
    else await request(`/shipments/${finalized.shipmentId}/reject`, 'RETAILER', { ...await versions(), reason: 'CI rejection scenario' });
    const trace = await request(`/public/trace/${harvest.traceQr.traceToken}`);
    assert.equal(trace.lotId, harvest.lot.id);
    // Fabric is off in this project: the honest public state is PENDING, never VERIFIED.
    assert.equal(trace.proofStatus, 'PENDING');
    assert.equal((await fetch(`${origin}/trace/${harvest.traceQr.traceToken}`)).status, 200, 'Public QR page failed to render');
  }
  let rotatedCookie;
  const refreshed = await request('/auth/refresh', undefined, {}, 201, undefined, { cookie: cookies.SYSTEM_ADMIN, onCookie: cookie => { rotatedCookie = cookie; } });
  assert.ok(refreshed.accessToken && rotatedCookie);
  await request('/auth/logout', undefined, {}, 201, undefined, { cookie: rotatedCookie });
  await request('/auth/refresh', undefined, {}, 401, undefined, { cookie: rotatedCookie });
  return { result: 'passed', roles, cycleId: cycle.id, lotIds: lots, traceTokens: tokensByLot,
    flows: ['login/me', 'RBAC rejection', 'idempotency replay', 'two harvests', 'shipment plan consent and finalize', 'shipment receive and reject', 'public QR PENDING', 'refresh rotation and logout'] };
}
