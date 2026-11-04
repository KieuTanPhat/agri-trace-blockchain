import { generateKeyPairSync, sign } from 'node:crypto';
import {
  classifyPosition,
  distanceMeters,
  longStops,
  routeDigest,
  summarizeRoute,
  type RoutePoint,
} from './route-seal.js';
import {
  deviceMessage,
  sentAtWithinSkew,
  verifyDeviceSignature,
} from './device-signature.js';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 4, 1, 0) + minutes * 60_000);
const point = (minutes: number, latitude: number, longitude: number, validity = 'VALID', sequence = minutes): RoutePoint => ({
  sequence,
  recordedAt: at(minutes),
  latitude,
  longitude,
  validity,
});

describe('route seal (ADR-006)', () => {
  it('measures great-circle distance', () => {
    // Roughly 1.11 km per 0.01 degree of latitude.
    expect(distanceMeters({ latitude: 10.77, longitude: 106.7 }, { latitude: 10.78, longitude: 106.7 })).toBeCloseTo(1112, -1);
  });

  it('flags jumps and poor accuracy but not normal driving', () => {
    const prev = { recordedAt: at(0), latitude: 10.77, longitude: 106.7 };
    expect(classifyPosition(prev, { recordedAt: at(1), latitude: 10.775, longitude: 106.7, accuracyM: 8 })).toBeNull();
    // 50 km in one minute.
    expect(classifyPosition(prev, { recordedAt: at(1), latitude: 11.22, longitude: 106.7, accuracyM: 8 })).toBe('JUMP');
    expect(classifyPosition(prev, { recordedAt: at(1), latitude: 10.771, longitude: 106.7, accuracyM: 250 })).toBe('LOW_ACCURACY');
    expect(classifyPosition(null, { recordedAt: at(1), latitude: 10.771, longitude: 106.7 })).toBeNull();
  });

  it('computes coverage from gaps longer than ten minutes', () => {
    const points = [point(0, 10.77, 106.7), point(5, 10.78, 106.7), point(10, 10.79, 106.7), point(40, 10.8, 106.7), point(60, 10.81, 106.7)];
    const s = summarizeRoute(points, at(0), at(60));
    // 30-minute gap (10 → 40) and 20-minute gap (40 → 60) are uncovered.
    expect(s.gaps.map((g) => g.seconds)).toEqual([1800, 1200]);
    expect(s.coveragePercent).toBeCloseTo(16.67, 1);
    expect(s.maxGapSeconds).toBe(1800);
    expect(s.distanceM).toBeGreaterThan(4000);
  });

  it('ignores anomalies and late points for distance', () => {
    const s = summarizeRoute([point(0, 10.77, 106.7), point(1, 11.5, 106.7, 'ANOMALY'), point(2, 10.771, 106.7)], at(0), at(2));
    expect(s.pointCount).toBe(2);
    expect(s.anomalyCount).toBe(1);
    expect(s.distanceM).toBeLessThan(200);
  });

  it('has zero coverage without points', () => {
    expect(summarizeRoute([], at(0), at(30)).coveragePercent).toBe(0);
  });

  it('finds long stops away from the destination only', () => {
    const stopped = Array.from({ length: 8 }, (_, i) => point(i * 5, 10.9, 106.8));
    const moving = [point(40, 10.95, 106.8), point(45, 11, 106.8)];
    expect(longStops([...stopped, ...moving], { latitude: 11, longitude: 106.8 })).toHaveLength(1);
    expect(longStops(stopped, { latitude: 10.9, longitude: 106.8 })).toHaveLength(0);
  });

  it('hashes valid points independent of input order', () => {
    const a = [point(0, 10.77, 106.7), point(1, 10.78, 106.7)];
    const b = [...a].reverse();
    expect(routeDigest('t1', a)).toBe(routeDigest('t1', b));
    expect(routeDigest('t1', [...a, point(2, 10.79, 106.7, 'LATE')])).toBe(routeDigest('t1', a));
    expect(routeDigest('t1', [a[0], { ...a[1], latitude: 10.781 }])).not.toBe(routeDigest('t1', a));
  });
});

describe('device signature (ADR-006)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const body = { deviceCode: 'GPS-001', sentAt: new Date().toISOString(), positions: [{ sequence: 1, recordedAt: new Date().toISOString(), latitude: 10.77, longitude: 106.7 }] };

  it('verifies a canonical signature regardless of key order', () => {
    const signature = sign(null, deviceMessage(body), privateKey).toString('base64url');
    const reordered = { positions: body.positions, sentAt: body.sentAt, deviceCode: body.deviceCode };
    expect(verifyDeviceSignature(spki, reordered, signature)).toBe(true);
  });

  it('rejects a changed body or another key', () => {
    const signature = sign(null, deviceMessage(body), privateKey).toString('base64url');
    expect(verifyDeviceSignature(spki, { ...body, deviceCode: 'GPS-002' }, signature)).toBe(false);
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
    expect(verifyDeviceSignature(other, body, signature)).toBe(false);
  });

  it('limits the sentAt clock skew', () => {
    const now = Date.now();
    expect(sentAtWithinSkew(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(sentAtWithinSkew(new Date(now - 10 * 60_000).toISOString(), now)).toBe(false);
    expect(sentAtWithinSkew('not a date', now)).toBe(false);
  });
});
