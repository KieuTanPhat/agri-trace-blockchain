import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { DeviceKeyGuard } from './device-key.guard.js';

describe('DeviceKeyGuard scoped credentials', () => {
  const deviceId = randomUUID();
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const credential = {
    id,
    deviceId,
    revision: 0,
    verifier: createHash('sha256').update(secret).digest('hex'),
    expiresAt: new Date(Date.now() + 3600000),
    revokedAt: null,
  };
  const requestFor = (key: string, device = deviceId) => ({
    body: { deviceId: device },
    header: () => key,
  });
  const context = (request: object) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as ExecutionContext;
  const guardFor = (row: object | null = credential) =>
    new DeviceKeyGuard({
      deviceCredential: { findUnique: async () => row },
    } as unknown as PrismaService);

  it('authenticates matching device and attaches no raw token', async () => {
    const request = requestFor(`${id}.${secret}`);
    await expect(guardFor().canActivate(context(request))).resolves.toBe(true);
    expect(request).toHaveProperty('deviceAuthentication', {
      deviceId,
      credentialId: id,
      revision: 0,
      verifier: credential.verifier,
    });
    expect(JSON.stringify(request)).not.toContain(secret);
  });
  it.each(['wrong', '', '\u00e9a', `${id}.${'x'.repeat(1000)}`])(
    'rejects malformed key %s',
    async (key) => {
      await expect(
        guardFor().canActivate(context(requestFor(key))),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );
  it('rejects another device', async () => {
    await expect(
      guardFor().canActivate(
        context(requestFor(`${id}.${secret}`, randomUUID())),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it.each([
    null,
    { ...credential, revokedAt: new Date() },
    { ...credential, expiresAt: new Date(0) },
  ])('rejects missing, revoked or expired credentials', async (row) => {
    await expect(
      guardFor(row).canActivate(context(requestFor(`${id}.${secret}`))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
