import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { newSessionIds } from './support/session.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
let app: INestApplication;
let jwt: JwtService;
const NOTE = 'Ghi chú xử lý hồ sơ kiểm thử đủ dài';

interface Actor {
  id: string;
  orgId: string | null;
  token: string;
}
async function actorWith(code: string, orgId: string | null): Promise<Actor> {
  const role = await prisma.role.upsert({
    where: { code },
    create: { code, name: code },
    update: {},
  });
  const user = await prisma.user.create({
    data: {
      fullName: code,
      email: `case-${randomUUID()}@example.test`,
      organizationId: orgId,
      roleId: role.id,
      passwordHash: 'unused-in-this-suite',
    },
  });
  const session = await prisma.refreshSession.create({
    data: { ...newSessionIds(),
      userId: user.id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return {
    id: user.id,
    orgId,
    token: jwt.sign({ sub: user.id, sid: session.id }),
  };
}
const org = (type: 'FARM' | 'AUDITOR') =>
  prisma.organization
    .create({ data: { name: `Case org ${randomUUID()}`, type } })
    .then((row) => row.id);

const call =
  (method: 'get' | 'post') =>
  (
    actor: Pick<Actor, 'token'>,
    path: string,
    body?: object,
    key: string | null = randomUUID(),
  ) => {
    let req = request(app.getHttpServer())
      [method](`/api/${path}`)
      .set('Authorization', `Bearer ${actor.token}`);
    if (method === 'post' && key) req = req.set('Idempotency-Key', key);
    return body ? req.send(body) : req;
  };
const get = call('get');
const post = call('post');

async function lotOf(organizationId: string) {
  const id = randomUUID();
  await prisma.$transaction(async (tx) => {
    // Lots normally come from a harvest; only the lot row matters here.
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.lot.create({
      data: {
        id,
        lotCode: `CASE-${randomUUID()}`,
        harvestId: randomUUID(),
        productId: randomUUID(),
        farmOrgId: organizationId,
        initialQuantity: 100,
        availableQuantity: 100,
        unit: 'kg',
      },
    });
  });
  return id;
}

describe('Platform incident cases (real PostgreSQL)', () => {
  let admin: Actor;
  let auditor: Actor;
  let owner: Actor;
  let stranger: Actor;
  let plain: Actor;
  let ownerOrg: string;
  let otherOrg: string;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: () => 'platform-cases-tests-only-secret',
        get: (_key: string, fallback: unknown) => fallback,
      })
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.init();
    jwt = app.get(JwtService);
    ownerOrg = await org('FARM');
    otherOrg = await org('FARM');
    admin = await actorWith('SYSTEM_ADMIN', null);
    auditor = await actorWith('AUDITOR', await org('AUDITOR'));
    owner = await actorWith('FARM_STAFF', ownerOrg);
    stranger = await actorWith('FARM_STAFF', otherOrg);
    // Organization-level admins: the "primary" enterprise accounts.
    for (const member of [owner, stranger])
      await prisma.scopedRoleGrant.create({
        data: {
          userId: member.id,
          organizationId: member.orgId!,
          scope: 'ORGANIZATION',
          role: 'ORG_ADMIN',
        },
      });
    plain = await actorWith('FARM_STAFF', ownerOrg);
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  const create = (extra: object = {}, actor = admin) =>
    post(actor, 'platform-cases', {
      title: 'Khiếu nại chất lượng rau',
      description: 'Người tiêu dùng báo rau có mùi lạ sau khi mua',
      category: 'QUALITY',
      severity: 'HIGH',
      source: 'CONSUMER',
      ...extra,
    });

  it('creates an unassigned case, then assigns it with a due date and notifies the owner', async () => {
    const created = (await create().expect(201)).body.data;
    expect(created).toMatchObject({
      status: 'OPEN',
      owner: null,
      overdue: false,
    });
    expect(created.caseNumber).toBeGreaterThan(0);
    // Nothing is addressed to the organization yet.
    expect(
      (await get(owner, 'enterprise-cases').expect(200)).body.data,
    ).toEqual([]);

    const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const assigned = (
      await post(admin, `platform-cases/${created.id}/assign`, {
        version: created.version,
        ownerOrganizationId: ownerOrg,
        responseDueAt: due,
        note: NOTE,
      }).expect(201)
    ).body.data;
    expect(assigned).toMatchObject({
      status: 'ASSIGNED',
      owner: { id: ownerOrg },
    });
    const mine = (await get(owner, 'enterprise-cases').expect(200)).body.data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: created.id, status: 'ASSIGNED' });
    // The organization never sees the source, the creator or internal history.
    expect(Object.keys(mine[0])).not.toEqual(
      expect.arrayContaining(['source', 'createdBy']),
    );
    expect(
      mine[0].events.map((event: { action: string }) => event.action),
    ).toEqual(['ASSIGNED']);
    // Another organization sees nothing and cannot act on it.
    expect(
      (await get(stranger, 'enterprise-cases').expect(200)).body.data,
    ).toEqual([]);
    await post(stranger, `enterprise-cases/${created.id}/respond`, {
      version: assigned.version,
      note: NOTE,
    }).expect(404);
  });

  it('defaults the owner to the lot producer and never changes the lot', async () => {
    const lotId = await lotOf(ownerOrg);
    const before = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    const created = (await create({ lotId }).expect(201)).body.data;
    expect(created).toMatchObject({
      status: 'ASSIGNED',
      owner: { id: ownerOrg },
      lot: { id: lotId },
    });
    const run = async (path: string, body: object) =>
      (
        await post(admin, `platform-cases/${created.id}/${path}`, body).expect(
          201,
        )
      ).body.data;
    let current = created;
    current = await run('classify', {
      version: current.version,
      category: 'SAFETY',
      severity: 'CRITICAL',
      note: NOTE,
    });
    current = await run('escalate', { version: current.version, note: NOTE });
    expect(current.status).toBe('ESCALATED');
    current = (
      await post(owner, `enterprise-cases/${created.id}/acknowledge`, {
        version: current.version,
      }).expect(201)
    ).body.data;
    expect(current.status).toBe('ACKNOWLEDGED');
    current = (
      await post(owner, `enterprise-cases/${created.id}/respond`, {
        version: current.version,
        note: 'Đã kiểm tra lô và chuyển hàng cho bộ phận chất lượng',
      }).expect(201)
    ).body.data;
    expect(current.status).toBe('RESPONDED');
    current = await run('close', {
      version: current.version,
      reason: 'Đã xác minh doanh nghiệp xử lý xong',
    });
    expect(current).toMatchObject({ status: 'CLOSED' });
    // The whole lifecycle left the lot exactly as it was: no recall, no state,
    // no quantity change, no new events.
    const after = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect(after).toEqual(before);
    expect(await prisma.traceEvent.count({ where: { lotId } })).toBe(0);
  });

  it('records the full history, hides internal notes from the organization and rejects edits to a closed case', async () => {
    const created = (
      await create({ ownerOrganizationId: ownerOrg }).expect(201)
    ).body.data;
    await post(admin, `platform-cases/${created.id}/notes`, {
      note: 'Nội bộ: nghi ngờ lô khác nhà cung cấp',
    }).expect(201);
    await post(admin, `platform-cases/${created.id}/notes`, {
      note: 'Vui lòng gửi hồ sơ kiểm nghiệm trước hạn',
      visibility: 'SHARED',
    }).expect(201);
    const detail = (
      await get(auditor, `platform-cases/${created.id}`).expect(200)
    ).body.data;
    expect(
      detail.events.map((event: { action: string }) => event.action),
    ).toEqual(['CREATED', 'ASSIGNED', 'NOTE', 'NOTE']);
    const mine = (
      await get(owner, 'enterprise-cases').expect(200)
    ).body.data.find((row: { id: string }) => row.id === created.id);
    const visible = JSON.stringify(mine.events);
    expect(visible).toContain('Vui lòng gửi hồ sơ kiểm nghiệm trước hạn');
    expect(visible).not.toContain('Nội bộ: nghi ngờ');
    // A shared note needs an owner.
    const unowned = (await create().expect(201)).body.data;
    await post(admin, `platform-cases/${unowned.id}/notes`, {
      note: 'Chia sẻ khi chưa có chủ sở hữu',
      visibility: 'SHARED',
    }).expect(422);
    // Close, then everything is refused.
    const closed = (
      await post(admin, `platform-cases/${created.id}/close`, {
        version: detail.version,
        reason: 'Khiếu nại không có cơ sở sau xác minh',
      }).expect(201)
    ).body.data;
    for (const [path, body] of [
      ['escalate', { version: closed.version, note: NOTE }],
      ['notes', { note: 'Ghi chú sau khi đóng' }],
      ['close', { version: closed.version, reason: 'Đóng lần hai bị từ chối' }],
    ] as const)
      await post(admin, `platform-cases/${created.id}/${path}`, body).expect(
        409,
      );
    await post(owner, `enterprise-cases/${created.id}/respond`, {
      version: closed.version,
      note: NOTE,
    }).expect(409);
    await expect(
      prisma.$executeRaw`UPDATE platform_case SET title = 'Đã sửa lịch sử' WHERE platform_case_id = ${created.id}::uuid`,
    ).rejects.toThrow(/closed and immutable/u);
    await expect(
      prisma.$executeRaw`DELETE FROM platform_case_event WHERE platform_case_id = ${created.id}::uuid`,
    ).rejects.toThrow(/append-only/u);
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE platform_case_event'),
    ).rejects.toThrow(/append-only/u);
  });

  it('flags and filters overdue cases and writes platform audit entries in the same transaction', async () => {
    const created = (
      await create({
        ownerOrganizationId: otherOrg,
        responseDueAt: new Date(Date.now() + 86_400_000).toISOString(),
      }).expect(201)
    ).body.data;
    // Move the due date into the past directly: the API only accepts a future date.
    await prisma.$executeRaw`UPDATE platform_case SET response_due_at = now() - interval '2 hours' WHERE platform_case_id = ${created.id}::uuid`;
    const listed = (
      await get(admin, 'platform-cases?overdue=true&limit=100').expect(200)
    ).body.data;
    expect(
      listed.items.some(
        (row: { id: string; overdue: boolean }) =>
          row.id === created.id && row.overdue,
      ),
    ).toBe(true);
    expect(listed.items.every((row: { overdue: boolean }) => row.overdue)).toBe(
      true,
    );
    const audit = await prisma.platformAudit.findMany({
      where: { subjectId: created.id },
    });
    expect(audit.map((row) => row.action)).toContain('CASE_CREATED');
    // A past due date is refused when set through the API.
    await post(admin, `platform-cases/${created.id}/assign`, {
      version: created.version,
      ownerOrganizationId: otherOrg,
      responseDueAt: new Date(Date.now() - 3_600_000).toISOString(),
      note: NOTE,
    }).expect(422);
  });

  it('enforces roles, optimistic versions, idempotency and input rules', async () => {
    await create({}, auditor).expect(403);
    await create({}, owner).expect(403);
    await get(owner, 'platform-cases').expect(403);
    // A member without the distribution permission cannot read or answer cases.
    await get(plain, 'enterprise-cases').expect(403);
    await get(stranger, `platform-cases/${randomUUID()}`).expect(403);
    await get(admin, 'enterprise-cases').expect(403);
    await create({ title: 'ngắn' }).expect(400);
    await create({ ownerOrganizationId: await org('AUDITOR') }).expect(422);
    await create({ lotId: randomUUID() }).expect(422);
    await create({
      responseDueAt: new Date(Date.now() + 86_400_000).toISOString(),
    }).expect(422);
    const key = randomUUID();
    const first = await post(
      admin,
      'platform-cases',
      {
        title: 'Hồ sơ kiểm thử idempotency',
        description: 'Gửi hai lần cùng một khóa, chỉ tạo một hồ sơ',
        category: 'OTHER',
        severity: 'LOW',
        source: 'INTERNAL',
      },
      key,
    ).expect(201);
    const replay = await post(
      admin,
      'platform-cases',
      {
        title: 'Hồ sơ kiểm thử idempotency',
        description: 'Gửi hai lần cùng một khóa, chỉ tạo một hồ sơ',
        category: 'OTHER',
        severity: 'LOW',
        source: 'INTERNAL',
      },
      key,
    );
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(
      await prisma.platformCase.count({
        where: { title: 'Hồ sơ kiểm thử idempotency' },
      }),
    ).toBe(1);
    await post(admin, `platform-cases/${first.body.data.id}/classify`, {
      version: 99,
      category: 'OTHER',
      severity: 'LOW',
      note: NOTE,
    }).expect(409);
  });
});
