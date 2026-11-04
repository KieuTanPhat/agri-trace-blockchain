import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
import { distanceMeters, drySoil, fieldClimate, gpsError, pointAt, prepareRoute, targetSpeed } from './device-models.mjs';

const route = prepareRoute(JSON.parse(await readFile(new URL('./routes/dalat-thuduc.json', import.meta.url), 'utf8')));

test('route length matches the recorded road distance', () => {
  assert.ok(Math.abs(route.length - route.distanceM) / route.distanceM < 0.02);
  const mid = pointAt(route, route.length / 2);
  assert.ok(mid.position[0] > 10.8 && mid.position[0] < 12);
  assert.ok(mid.heading >= 0 && mid.heading < 360);
});

test('speed is slower on the mountain pass than on the open road', () => {
  const at = new Date('2026-11-04T05:00:00Z'); // 12:00 in Vietnam, no rush hour
  const pass = [11.45, 107.7];
  const open = pointAt(route, 200_000).position;
  assert.ok(targetSpeed(route, 120_000, pass, 'x', at) <= 30);
  assert.ok(targetSpeed(route, 200_000, open, 'x', at) > 40);
});

test('field climate follows the day and humidity runs opposite to heat', () => {
  const night = fieldClimate('plot', new Date('2026-11-04T22:00:00Z'), { soil: 40 }); // 05:00 local
  const noon = fieldClimate('plot', new Date('2026-11-04T07:00:00Z'), { soil: 40 }); // 14:00 local
  assert.ok(noon.TEMPERATURE.value > night.TEMPERATURE.value + 5);
  assert.ok(noon.HUMIDITY.value < night.HUMIDITY.value);
});

test('soil dries faster in drought and stays in physical bounds', () => {
  const at = new Date('2026-11-04T06:00:00Z');
  assert.ok(drySoil('p', 40, at, 60, true) < drySoil('p', 40, at, 60, false));
  assert.ok(drySoil('p', 13, at, 600, true) >= 12);
});

test('GPS error is a few metres and deterministic per sequence', () => {
  const a = gpsError('dev', 7, false);
  assert.deepEqual(a, gpsError('dev', 7, false));
  const metres = distanceMeters([10.8, 106.7], [10.8 + a.dLat, 106.7 + a.dLng]);
  assert.ok(metres < 150);
});

test('device signature matches the API message format', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const body = { positions: [{ sequence: 1, latitude: 10.8 }], deviceCode: 'SIM-GPS-1', sentAt: '2026-11-04T01:00:00.000Z' };
  const message = (b) => Buffer.concat([Buffer.from('agritrace:iot-device:1'), Buffer.from([0]), Buffer.from(canonicalize(b))]);
  const signature = sign(null, message(body), privateKey);
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  assert.equal(spki.length, 59);
  const reordered = { sentAt: body.sentAt, deviceCode: body.deviceCode, positions: body.positions };
  assert.ok(verify(null, message(reordered), createPublicKey({ key: Buffer.from(spki, 'base64url'), format: 'der', type: 'spki' }), signature));
});

test('a saved GPS adopts automatic dispatch, preserves its identity and stops after delivery', { timeout: 40_000 }, async (t) => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve, sep } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'agritrace-iot-sim-test-'));
  const pair = generateKeyPairSync('ed25519');
  const privateKeyPem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const deviceCode = 'SIM-GPS-EXISTING';
  let trip = {
    transferId: 'isolated-transfer', inTransitAt: new Date(Date.now() - 60_000).toISOString(),
    origin: { name: 'Giao', latitude: 10.8, longitude: 106.7 },
    destination: { name: 'Nhận', latitude: 10.81, longitude: 106.71 },
  };
  let signedReads = 0;
  let nextTripKnownAt = null;
  let previousRouteFixes = 0;
  const api = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/route/v1/')) {
      const coordinates = req.url.split('/driving/')[1].split('?')[0].split(';').map((point) => point.split(',').map(Number));
      if (coordinates[0][1] > 11) await new Promise((done) => setTimeout(done, 2000));
      return res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 1600, duration: 130, geometry: { coordinates } }] }));
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const message = Buffer.concat([Buffer.from('agritrace:iot-device:1'), Buffer.from([0]), Buffer.from(canonicalize(body))]);
    if (!verify(null, message, pair.publicKey, Buffer.from(req.headers['x-device-signature'], 'base64url'))) {
      res.statusCode = 401;
      return res.end('{}');
    }
    if (req.url.endsWith('/device/assignment')) {
      signedReads++;
      if (trip?.transferId === 'isolated-next-trip') nextTripKnownAt ??= Date.now();
      return res.end(JSON.stringify({ data: { device: { deviceCode, active: true }, plot: null, vehicle: { registration: 'TEST' }, trip } }));
    }
    previousRouteFixes += body.positions.filter((position) => nextTripKnownAt && Date.parse(position.recordedAt) >= nextTripKnownAt && position.latitude < 11).length;
    res.end(JSON.stringify({ data: { accepted: body.positions.length, duplicates: 0, ignored: 0, late: 0, anomalies: 0, rejected: 0 } }));
  });
  await new Promise((done) => api.listen(0, '127.0.0.1', done));
  const apiOrigin = `http://127.0.0.1:${api.address().port}`;
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise((done) => { child.once('exit', done); child.kill(); });
    }
    await new Promise((done) => api.close(done));
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    await rm(dir, { recursive: true, force: true });
  });
  // Deliberately omit mode, as in a state file from before automatic dispatch.
  await writeFile(join(dir, 'state.json'), JSON.stringify({ devices: [{
    id: 'existing', deviceCode, name: 'GPS', kind: 'GPS_TRACKER', privateKeyPem,
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    sequence: 1, queue: [], signal: true, power: 'MAINS', battery: 100, soil: 40,
    intervalSec: 300, bootAt: Date.now(), trip: null,
  }] }));
  child = spawn(process.execPath, [fileURLToPath(new URL('./simulator.mjs', import.meta.url))], {
    env: { ...process.env, AGRITRACE_API_URL: `${apiOrigin}/api`, IOT_SIM_OSRM_URL: apiOrigin, IOT_SIM_PORT: '0', IOT_SIM_STATE_DIR: dir },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const panelOrigin = await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', () => fail(new Error('Simulator exited before listening')));
    child.stdout.on('data', (data) => {
      const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) done(match[0]);
    });
  });
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const device = (await (await fetch(`${panelOrigin}/api/state`)).json()).devices[0];
      if (predicate(device)) return device;
      await new Promise((done) => setTimeout(done, 200));
    }
    assert.fail('Automatic dispatch did not reach the expected state');
  };
  const running = await waitFor((device) => device.trip?.transferId === trip.transferId);
  assert.equal(running.mode, 'AUTO');
  assert.ok(!('privateKeyPem' in running));
  // The next assignment can arrive before the previous stop was polled. A
  // slow route planner must not upload old-route positions into the new trip.
  trip = {
    transferId: 'isolated-next-trip', inTransitAt: new Date().toISOString(),
    origin: { name: 'Điểm giao mới', latitude: 12, longitude: 108 },
    destination: { name: 'Điểm nhận mới', latitude: 12.01, longitude: 108.01 },
  };
  const synced = await fetch(`${panelOrigin}/api/devices/existing/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(synced.status, 200);
  await waitFor((device) => device.trip?.transferId === 'isolated-next-trip');
  assert.equal(previousRouteFixes, 0);
  trip = null;
  await waitFor((device) => device.assignmentAt && device.trip === null);
  assert.ok(signedReads >= 2);
  const saved = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).devices[0];
  assert.ok(saved.privateKeyPem === privateKeyPem, 'preserves the saved device identity');
  assert.ok(saved.sequence > 1, 'keeps the device sequence after replaying the trip');
});
