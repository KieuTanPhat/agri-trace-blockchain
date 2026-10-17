import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
describe('IoT device assets on isolated PostgreSQL', () => {
  let app: INestApplication;
  let admin: string,
    owner: string,
    other: string,
    orgId: string,
    ownerId: string;
  const post = (
    path: string,
    body: object,
    token: string,
    key = randomUUID(),
  ) =>
    request(app.getHttpServer())
      .post(`/api${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
  const get = (path: string, token = owner) =>
    request(app.getHttpServer())
      .get(`/api${path}`)
      .set('Authorization', `Bearer ${token}`);
  const register = async () => {
    const email = `iot-${randomUUID()}@example.test`;
    const password = 'iot-isolated-test-password';
    await post(
      '/auth/register',
      {
        requestId: randomUUID(),
        email,
        password,
        fullName: 'IoT test owner',
        organizationName: 'IoT test org',
        businessId: `IOT-${randomUUID().slice(0, 12)}`,
        organizationType: 'TRANSPORTER',
        hostingMode: 'MANAGED_ORG',
      },
      '',
    ).expect(201);
    const login = await post('/auth/login', { email, password }, '').expect(
      201,
    );
    const token = login.body.data.accessToken as string;
    const enrollment = (
      await get('/enterprise-enrollments/mine', token).expect(200)
    ).body.data;
    await post(
      `/enterprise-enrollments/${enrollment.id}/review`,
      { version: 0, decision: 'APPROVE', note: 'Isolated IoT fixture' },
      admin,
    ).expect(201);
    return { token, enrollment };
  };
  const createDevice = async () =>
    (
      await post(
        '/iot/devices',
        {
          name: 'DHT22',
          deviceCode: randomUUID(),
          sourceType: 'WOKWI_SIMULATED',
        },
        owner,
      ).expect(201)
    ).body.data;
  const credentialBody = (version: number) => ({
    version,
    credentialId: randomUUID(),
    verifier: createHash('sha256')
      .update(randomBytes(32).toString('base64url'))
      .digest('hex'),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  beforeAll(async () => {
    process.env.ENTERPRISE_ONBOARDING_ENABLED = 'true';
    const role = await prisma.role.upsert({
      where: { code: 'SYSTEM_ADMIN' },
      update: {},
      create: { code: 'SYSTEM_ADMIN', name: 'Admin' },
    });
    await prisma.role.upsert({
      where: { code: 'TRANSPORTER' },
      update: {},
      create: { code: 'TRANSPORTER', name: 'Transporter' },
    });
    const user = await prisma.user.create({
      data: {
        roleId: role.id,
        email: `iot-admin-${randomUUID()}@example.test`,
        passwordHash: 'fixture-only',
        fullName: 'Admin',
      },
    });
    const sid = randomUUID();
    await prisma.refreshSession.create({
      data: {
        id: sid,
        familyId: sid,
        userId: user.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    admin = app.get(JwtService).sign({ sub: user.id, sid });
    const first = await register();
    owner = first.token;
    orgId = first.enrollment.organizationId;
    const dbEnrollment = await prisma.enterpriseEnrollment.findUniqueOrThrow({
      where: { id: first.enrollment.id },
    });
    orgId = dbEnrollment.organizationId;
    ownerId = dbEnrollment.ownerId;
    other = (await register()).token;
  });
  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it('registers under actor organization and rejects platform/other-org mutation', async () => {
    const device = await createDevice();
    expect(device.organizationId).toBe(orgId);
    expect(device.sourceType).toBe('WOKWI_SIMULATED');
    await post(
      '/iot/devices',
      { name: 'x', deviceCode: randomUUID(), sourceType: 'WOKWI_SIMULATED' },
      admin,
    ).expect(403);
    await post(
      `/iot/devices/${device.id}/credentials`,
      credentialBody(0),
      other,
    ).expect(403);
    await get(`/iot/devices/${device.id}/credentials`, other).expect(403);
    expect(
      (await get('/iot/devices/managed').expect(200)).body.data.some(
        (row: { id: string }) => row.id === device.id,
      ),
    ).toBe(true);
  });
  it('issues once, replays metadata, rotates atomically and preserves revoked history', async () => {
    const device = await createDevice();
    const body = credentialBody(0);
    const key = randomUUID();
    const result = (
      await post(
        `/iot/devices/${device.id}/credentials`,
        body,
        owner,
        key,
      ).expect(201)
    ).body.data;
    expect(result.deviceVersion).toBe(1);
    expect(result.authorityRevision).toBe(1);
    expect(JSON.stringify(result)).not.toContain(body.verifier);
    const replay = (
      await post(
        `/iot/devices/${device.id}/credentials`,
        body,
        owner,
        key,
      ).expect(201)
    ).body.data;
    expect(replay).toEqual(result);
    const inspected = await post(
      '/command-requests/status',
      {
        operation: 'IOT_ISSUE_CREDENTIAL',
        payload: { deviceId: device.id, ...body },
      },
      owner,
      key,
    ).expect(200);
    expect(inspected.body.data.status).toBe('COMMITTED');
    expect(inspected.body.data.result).toEqual(result);
    await post(
      `/iot/devices/${device.id}/credentials`,
      { ...body, verifier: '0'.repeat(64) },
      owner,
      key,
    ).expect(409);
    const rotated = (
      await post(
        `/iot/devices/${device.id}/credentials/rotate`,
        credentialBody(1),
        owner,
      ).expect(201)
    ).body.data;
    expect(rotated.deviceVersion).toBeGreaterThan(1);
    expect(
      await prisma.deviceCredential.count({
        where: { deviceId: device.id, revokedAt: null },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.deviceCredential.findUniqueOrThrow({
          where: { id: body.credentialId },
        })
      ).revokedAt,
    ).not.toBeNull();
    await post(
      `/iot/devices/${device.id}/credentials/${rotated.credential.id}/revoke`,
      { version: rotated.deviceVersion },
      owner,
    ).expect(201);
    expect(
      await prisma.deviceCredential.count({
        where: { deviceId: device.id, revokedAt: null },
      }),
    ).toBe(0);
    const journal = await prisma.commandCommit.findFirstOrThrow({
      where: { requesterId: ownerId, operation: 'IOT_ISSUE_CREDENTIAL' },
      orderBy: { committedAt: 'desc' },
    });
    expect(JSON.stringify(journal.responseBody)).not.toMatch(/verifier|secret/);
  });
  it('only commits one of two simultaneous issuance commands at the same version', async () => {
    const device = await createDevice();
    const results = await Promise.all([
      post(`/iot/devices/${device.id}/credentials`, credentialBody(0), owner),
      post(`/iot/devices/${device.id}/credentials`, credentialBody(0), owner),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.deviceCredential.count({ where: { deviceId: device.id } }),
    ).toBe(1);
  });
  it('checks version before changing status and blocks issuing to an inactive device', async () => {
    const device = await createDevice();
    const patch = (version: number) =>
      request(app.getHttpServer())
        .patch(`/api/iot/devices/${device.id}/status`)
        .set('Authorization', `Bearer ${owner}`)
        .set('Idempotency-Key', randomUUID())
        .send({ version, status: 'INACTIVE' });
    await patch(99).expect(409);
    const unchanged = await prisma.iotDevice.findUniqueOrThrow({
      where: { id: device.id },
    });
    expect(unchanged.version).toBe(0);
    expect(unchanged.status).toBe('ACTIVE');
    const changed = (await patch(0).expect(200)).body.data;
    expect(changed.version).toBe(1);
    expect(changed.authorityRevision).toBe(1);
    await post(
      `/iot/devices/${device.id}/credentials`,
      credentialBody(1),
      owner,
    ).expect(409);
    expect(
      await prisma.deviceCredential.count({ where: { deviceId: device.id } }),
    ).toBe(0);
  });
  it('authenticates device inspection, rejects cross-device payload and rejects revoked credentials', async () => {
    const device = await createDevice();
    const secret = randomBytes(32).toString('base64url');
    const body = {
      ...credentialBody(0),
      verifier: createHash('sha256').update(secret).digest('hex'),
    };
    const issued = (
      await post(`/iot/devices/${device.id}/credentials`, body, owner).expect(
        201,
      )
    ).body.data;
    const inspect = (token: string, payloadDevice = randomUUID()) =>
      request(app.getHttpServer())
        .post('/api/iot/device-commands/status')
        .set('X-Device-Key', token)
        .set('Idempotency-Key', randomUUID())
        .send({
          deviceId: device.id,
          operation: 'INGEST_SHIPMENT_TELEMETRY',
          payload: { deviceId: payloadDevice, shipmentId: randomUUID() },
        });
    const token = `${body.credentialId}.${secret}`;
    await inspect(token).expect(403);
    await inspect('legacy-shared-key').expect(401);
    await post(
      `/iot/devices/${device.id}/credentials/${body.credentialId}/revoke`,
      { version: issued.deviceVersion },
      owner,
    ).expect(201);
    await inspect(token, device.id).expect(401);
    for (const path of [
      '/iot/device-readings',
      `/iot/shipments/${randomUUID()}/device-telemetry`,
    ]) {
      await request(app.getHttpServer())
        .post(`/api${path}`)
        .set('X-Device-Key', token)
        .set('Idempotency-Key', randomUUID())
        .send({ deviceId: device.id })
        .expect(401);
    }
  });
  it('rejects SQL owner/source/verifier/history rewrites', async () => {
    const device = await createDevice();
    const body = credentialBody(0);
    await post(`/iot/devices/${device.id}/credentials`, body, owner).expect(
      201,
    );
    await expect(
      prisma.$executeRaw`UPDATE iot_device SET source_type='UNKNOWN' WHERE device_id=${device.id}::uuid`,
    ).rejects.toThrow();
    const otherEnrollment = (
      await get('/enterprise-enrollments/mine', other).expect(200)
    ).body.data;
    await expect(
      prisma.$executeRaw`UPDATE iot_device SET organization_id=${otherEnrollment.organizationId}::uuid WHERE device_id=${device.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE device_credential SET verifier=${'1'.repeat(64)} WHERE credential_id=${body.credentialId}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`DELETE FROM device_credential WHERE credential_id=${body.credentialId}::uuid`,
    ).rejects.toThrow();
  });
  it('rechecks revoked ORG_ADMIN before replay', async () => {
    const device = await createDevice();
    const body = credentialBody(0);
    const key = randomUUID();
    await post(
      `/iot/devices/${device.id}/credentials`,
      body,
      owner,
      key,
    ).expect(201);
    await prisma.scopedRoleGrant.updateMany({
      where: { userId: ownerId, role: 'ORG_ADMIN', revokedAt: null },
      data: { revokedAt: new Date(), revision: { increment: 1 } },
    });
    await post(
      `/iot/devices/${device.id}/credentials`,
      body,
      owner,
      key,
    ).expect(403);
    await get('/iot/devices/managed').expect(403);
  });
});
