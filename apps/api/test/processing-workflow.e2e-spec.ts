import {
  ValidationPipe,
  type INestApplication,
  type ArgumentsHost,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { provisionChain } from './support/chain-scope.js';
import { newSessionIds } from './support/session.js';

// HTTP, PostgreSQL constraints, reservation locks, journal and outbox are real.
// Chain provisioning uses an explicitly simulated binding, never real Fabric.
describe('Processing lifecycle / isolated PostgreSQL', () => {
  const connectionString = process.env.TEST_DATABASE_URL!;
  const url = new URL(connectionString);
  if (
    !['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) ||
    !/(test|_ci)/i.test(url.pathname)
  )
    throw new Error('Owned isolated local test database required');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const tag = randomUUID();
  let app: INestApplication;
  let organizationId: string,
    chainId: string,
    siteId: string,
    productId: string;
  let owner: string, foreign: string;
  let lastServerError: unknown;
  const post = (
    path: string,
    body: object,
    token = owner,
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
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp3sAAAAASUVORK5CYII=',
    'base64',
  );

  beforeAll(async () => {
    const farm = await db.organization.create({
      data: { name: `[TEST] Supplier ${tag}`, type: 'FARM' },
    });
    const processor = await db.organization.create({
      data: { name: `[TEST] Processor ${tag}`, type: 'PROCESSOR' },
    });
    const outsider = await db.organization.create({
      data: { name: `[TEST] Other processor ${tag}`, type: 'PROCESSOR' },
    });
    organizationId = processor.id;
    const users = [];
    for (const [org, roleCode] of [
      [farm, 'FARM_STAFF'],
      [processor, 'PROCESSOR'],
      [outsider, 'PROCESSOR'],
    ] as const) {
      const role = await db.role.upsert({
        where: { code: roleCode },
        create: { code: roleCode, name: roleCode },
        update: {},
      });
      users.push(
        await db.user.create({
          data: {
            organizationId: org.id,
            roleId: role.id,
            email: `${randomUUID()}@example.test`,
            fullName: '[TEST] Operator',
            passwordHash: 'not-a-login-fixture',
            enterpriseTier: 1,
          },
        }),
      );
    }
    chainId = await provisionChain(db, {
      ownerOrganizationId: farm.id,
      memberOrganizationIds: [processor.id],
      grants: [
        { userId: users[0].id, organizationId: farm.id, role: 'ORG_ADMIN' },
        { userId: users[0].id, organizationId: farm.id, role: 'FARM_STAFF' },
        {
          userId: users[1].id,
          organizationId: processor.id,
          role: 'ORG_ADMIN',
        },
        {
          userId: users[1].id,
          organizationId: processor.id,
          role: 'PROCESSOR',
        },
      ],
    });
    await db.scopedRoleGrant.create({
      data: {
        userId: users[2].id,
        organizationId: outsider.id,
        scope: 'ORGANIZATION',
        role: 'ORG_ADMIN',
      },
    });
    siteId = (
      await db.enterpriseSite.create({
        data: {
          organizationId,
          name: '[TEST] Processing site',
          kind: 'PROCESSING',
          address: 'Isolated test fixture address',
        },
      })
    ).id;
    productId = (
      await db.product.create({
        data: {
          organizationId,
          productName: '[TEST] Dried fruit',
          defaultUnit: 'kg',
        },
      })
    ).id;
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          JWT_SECRET: 'isolated-processing-tests-only',
          JWT_EXPIRES_IN: '1h',
          NODE_ENV: 'test',
          PASSWORD_MAX_AGE_DAYS: '0',
        }),
      )
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    const filter = new GlobalExceptionFilter();
    app.useGlobalFilters({
      catch(error: unknown, host: ArgumentsHost) {
        lastServerError = error;
        filter.catch(error, host);
      },
    });
    await app.init();
    const tokens: string[] = [];
    for (const user of users.slice(1)) {
      const session = await db.refreshSession.create({
        data: {
          ...newSessionIds(),
          userId: user.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      tokens.push(app.get(JwtService).sign({ sub: user.id, sid: session.id }));
    }
    [owner, foreign] = tokens;
  });
  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });

  async function receipt(withImage = true) {
    const created = await post('/processing-runs/receipts', {
      siteId,
      materialName: '[TEST] Fresh fruit',
      supplierName: '[TEST] External supplier',
      documentNo: randomUUID(),
      receivedAt: new Date().toISOString(),
      quantity: '10.000',
      unit: 'kg',
    }).expect(201);
    const id = created.body.data.record.id as string;
    if (withImage)
      await request(app.getHttpServer())
        .post('/api/enterprise-workspace/evidence')
        .set('Authorization', `Bearer ${owner}`)
        .set('Idempotency-Key', randomUUID())
        .field('entityType', 'MATERIAL_RECEIPT')
        .field('entityId', id)
        .field('kind', 'RECEIPT_DOCUMENT')
        .field(
          'description',
          'Synthetic fixture image; not a real supplier certificate',
        )
        .attach('file', image, {
          filename: 'fixture.png',
          contentType: 'image/png',
        })
        .expect(201);
    return id;
  }
  const plan = (receiptId: string) => ({
    chainId,
    siteId,
    productId,
    processType: 'DRYING',
    baseUnit: 'kg',
    inputs: [],
    externalInputs: [{ receiptId, quantity: '10.000' }],
  });
  async function draft(receiptId: string) {
    return (await post('/processing-runs', plan(receiptId)).expect(201)).body
      .data.record;
  }
  const result = (version = 1) => ({
    version,
    output: { quantity: '8.000', unit: 'kg' },
    byProducts: [],
    losses: [{ reason: 'MOISTURE', quantity: '2.000' }],
  });

  it('requires receipt evidence before planning without consuming any quantity', async () => {
    const receiptId = await receipt(false);
    await post('/processing-runs', plan(receiptId)).expect(409);
    const row = await db.materialReceipt.findUniqueOrThrow({
      where: { id: receiptId },
    });
    expect(row.reserved.toFixed(3)).toBe('0.000');
    expect(row.consumed.toFixed(3)).toBe('0.000');
    expect(
      await db.processingExternalInput.count({ where: { receiptId } }),
    ).toBe(0);
  });
  it('records a balanced run once with its QR, movement, event and outbox', async () => {
    const receiptId = await receipt(),
      run = await draft(receiptId);
    await post(`/processing-runs/${run.id}/start`, { version: 0 }).expect(201);
    await post(`/processing-runs/${run.id}/logs`, {
      step: 'DRYING',
      occurredAt: new Date().toISOString(),
      note: 'Synthetic drying log',
    }).expect(201);
    const key = randomUUID(),
      body = result();
    const first = await post(
      `/processing-runs/${run.id}/complete`,
      body,
      owner,
      key,
    );
    expect(
      first.status,
      lastServerError instanceof Error
        ? lastServerError.message
        : 'Completion response',
    ).toBe(201);
    const replay = await post(
      `/processing-runs/${run.id}/complete`,
      body,
      owner,
      key,
    ).expect(201);
    expect(replay.body.data).toEqual(first.body.data);
    const completed = first.body.data.record;
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      inputTotal: '10.000',
      outputTotal: '8.000',
      lossTotal: '2.000',
    });
    expect(completed.outputs).toHaveLength(1);
    expect(completed.outputs[0].traceToken).toBeTruthy();
    const lotId = completed.outputs[0].lotId as string;
    expect(await db.lot.count({ where: { processingRunId: run.id } })).toBe(1);
    const events = await db.traceEvent.findMany({
      where: { lotId },
      select: { id: true },
    });
    expect(events).toHaveLength(1);
    expect(
      await db.blockchainOutbox.count({
        where: { eventId: { in: events.map((event) => event.id) } },
      }),
    ).toBe(1);
    expect(
      await db.quantityMovement.count({
        where: { lotId, type: 'PROCESSING_IN' },
      }),
    ).toBe(1);
    // SQL guards must still reject forged scope; existing contexts stay immutable.
    await expect(
      db.eventChainContext.create({
        data: { eventId: events[0].id, chainId: randomUUID() },
      }),
    ).rejects.toThrow('Event context chain mismatch');
    const pinned = await db.eventBindingContext.findUniqueOrThrow({
      where: { eventId: events[0].id },
    });
    await expect(
      db.eventBindingContext.create({
        data: {
          eventId: events[0].id,
          bindingDigest: 'f'.repeat(64),
          privateBodyDigest: pinned.privateBodyDigest,
        },
      }),
    ).rejects.toThrow('Event binding differs');
    const row = await db.materialReceipt.findUniqueOrThrow({
      where: { id: receiptId },
    });
    expect(row.reserved.toFixed(3)).toBe('0.000');
    expect(row.consumed.toFixed(3)).toBe('10.000');
  });
  it('rolls back an unbalanced completion and keeps reserved stock for correction', async () => {
    const receiptId = await receipt(),
      run = await draft(receiptId);
    await post(`/processing-runs/${run.id}/start`, { version: 0 }).expect(201);
    await post(`/processing-runs/${run.id}/complete`, {
      ...result(),
      losses: [],
    }).expect(422);
    expect(
      await db.processingRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({ status: 'IN_PROGRESS', version: 1 });
    expect(await db.processingOutput.count({ where: { runId: run.id } })).toBe(
      0,
    );
    expect(await db.lot.count({ where: { processingRunId: run.id } })).toBe(0);
    const row = await db.materialReceipt.findUniqueOrThrow({
      where: { id: receiptId },
    });
    expect(row.reserved.toFixed(3)).toBe('10.000');
    expect(row.consumed.toFixed(3)).toBe('0.000');
  });
  it('serializes competing starts so the same material is reserved only once', async () => {
    const receiptId = await receipt(),
      a = await draft(receiptId),
      b = await draft(receiptId);
    const responses = await Promise.all([
      post(`/processing-runs/${a.id}/start`, { version: 0 }),
      post(`/processing-runs/${b.id}/start`, { version: 0 }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const row = await db.materialReceipt.findUniqueOrThrow({
      where: { id: receiptId },
    });
    expect(row.reserved.toFixed(3)).toBe('10.000');
  });
  it('hides foreign receipts and refuses processing outside current chain authority', async () => {
    const receiptId = await receipt();
    await get(`/processing-runs/receipts/${receiptId}`, foreign).expect(404);
    await post('/processing-runs', plan(receiptId), foreign).expect(403);
    expect(
      await db.processingExternalInput.count({ where: { receiptId } }),
    ).toBe(0);
  });
  it('releases reserved material on cancellation and lets a replacement run use it', async () => {
    const receiptId = await receipt(),
      run = await draft(receiptId);
    await post(`/processing-runs/${run.id}/start`, { version: 0 }).expect(201);
    await post(`/processing-runs/${run.id}/cancel`, {
      version: 1,
      reason: 'Hủy mẻ kiểm thử để trả nguyên liệu',
    }).expect(201);
    const row = await db.materialReceipt.findUniqueOrThrow({
      where: { id: receiptId },
    });
    expect(row.reserved.toFixed(3)).toBe('0.000');
    expect(row.consumed.toFixed(3)).toBe('0.000');
    const replacement = await draft(receiptId);
    await post(`/processing-runs/${replacement.id}/start`, {
      version: 0,
    }).expect(201);
    await post(`/processing-runs/${run.id}/start`, { version: 2 }).expect(409);
  });
  it('appends a log correction without changing the original evidence', async () => {
    const run = await draft(await receipt());
    await post(`/processing-runs/${run.id}/start`, { version: 0 }).expect(201);
    const original = (
      await post(`/processing-runs/${run.id}/logs`, {
        step: 'DRYING',
        occurredAt: new Date().toISOString(),
        note: 'Original test observation',
      }).expect(201)
    ).body.data.record;
    await post(`/processing-runs/${run.id}/logs`, {
      step: 'CORRECTION',
      occurredAt: new Date().toISOString(),
      correctsId: original.id,
      note: 'Corrected test observation',
    }).expect(201);
    const logs = await db.processingLog.findMany({ where: { runId: run.id } });
    expect(logs).toHaveLength(2);
    expect(logs.find((log) => log.id === original.id)?.note).toBe(
      'Original test observation',
    );
    expect(logs.find((log) => log.correctsId === original.id)?.note).toBe(
      'Corrected test observation',
    );
    await post(`/processing-runs/${run.id}/logs`, {
      step: 'CORRECTION',
      occurredAt: new Date().toISOString(),
      note: 'No target selected',
    }).expect(422);
  });
});
