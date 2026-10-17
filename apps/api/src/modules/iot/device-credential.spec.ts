import { createHash } from 'node:crypto';
import { matchesDeviceCredential } from './device-credential.js';
import { monitoringContact } from './monitoring-contact.js';

describe('device credential authentication primitive', () => {
  // Public fixture only. Real credentials must use cryptographically random secrets.
  const secret = Buffer.alloc(32, 7).toString('base64url');
  const credential = {
    id: '00000000-0000-4000-8000-000000000001',
    deviceId: '00000000-0000-4000-8000-000000000002',
    verifier: createHash('sha256').update(secret).digest('hex'),
    expiresAt: new Date('2026-10-17T02:00:00Z'),
    revokedAt: null,
  };
  const now = new Date('2026-10-17T01:00:00Z');
  const token = `${credential.id}.${secret}`;
  it('requires matching credential, canonical device and verifier', () => {
    expect(
      matchesDeviceCredential(token, credential.deviceId, credential, now),
    ).toBe(true);
    expect(
      matchesDeviceCredential(token, 'sensor-alias', credential, now),
    ).toBe(false);
    expect(matchesDeviceCredential(token, credential.id, credential, now)).toBe(
      false,
    );
    expect(
      matchesDeviceCredential(
        token,
        credential.deviceId,
        { ...credential, verifier: '0'.repeat(64) },
        now,
      ),
    ).toBe(false);
    expect(
      matchesDeviceCredential(
        `${credential.deviceId}.${secret}`,
        credential.deviceId,
        credential,
        now,
      ),
    ).toBe(false);
  });
  it('rejects expiry, revocation and malformed secret without throwing or returning secret', () => {
    expect(
      matchesDeviceCredential(
        token,
        credential.deviceId,
        credential,
        credential.expiresAt,
      ),
    ).toBe(false);
    expect(
      matchesDeviceCredential(
        token,
        credential.deviceId,
        { ...credential, revokedAt: now },
        now,
      ),
    ).toBe(false);
    for (const supplied of [
      '',
      'shared-key',
      `${token}=`,
      `${token}.extra`,
      `${credential.id}.short`,
      'x'.repeat(10000),
    ])
      expect(
        matchesDeviceCredential(supplied, credential.deviceId, credential, now),
      ).toBe(false);
    expect(
      matchesDeviceCredential(
        token,
        credential.deviceId,
        { ...credential, verifier: 'oops' },
        now,
      ),
    ).toBe(false);
  });
});

describe('independent device contact and sensor freshness', () => {
  const input = {
    now: '2026-10-17T01:01:00Z',
    lastTelemetryReceivedAt: '2026-10-17T01:00:59Z',
    lastHeartbeatReceivedAt: null,
    newestRecordedAt: '2026-10-17T00:59:00Z',
    contactTimeoutSeconds: 30,
    sensorError: false,
  };
  it('backfill is contact evidence but never a fresh current measurement', () => {
    expect(monitoringContact(input)).toEqual({
      contact: 'ONLINE',
      measurement: 'STALE',
      lastSeenAt: '2026-10-17T01:00:59.000Z',
    });
  });
  it('heartbeats cannot hide sensor failure/no data and use the latest server receipt', () => {
    expect(monitoringContact({ ...input, sensorError: true }).measurement).toBe(
      'SENSOR_ERROR',
    );
    expect(
      monitoringContact({ ...input, newestRecordedAt: null }).measurement,
    ).toBe('NO_DATA');
    expect(
      monitoringContact({
        ...input,
        lastTelemetryReceivedAt: '2026-10-17T01:00:00Z',
        lastHeartbeatReceivedAt: '2026-10-17T01:00:58Z',
      }).contact,
    ).toBe('ONLINE');
    expect(
      monitoringContact({ ...input, lastTelemetryReceivedAt: null }).contact,
    ).toBe('NEVER_SEEN');
    expect(
      monitoringContact({
        ...input,
        lastTelemetryReceivedAt: '2026-10-17T01:00:29Z',
      }).contact,
    ).toBe('OFFLINE');
    expect(() =>
      monitoringContact({
        ...input,
        lastTelemetryReceivedAt: '2026-10-17T02:00:00Z',
      }),
    ).toThrow();
  });
});
