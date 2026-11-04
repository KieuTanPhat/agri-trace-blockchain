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
