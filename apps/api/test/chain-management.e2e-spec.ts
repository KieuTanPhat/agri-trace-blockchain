import {
  ArgumentsHost,
  HttpException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
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

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
});
const actors: Record<
  string,
  { id: string; org: string | null; token: string }
> = {};
let app: INestApplication;
let jwt: JwtService;
let chainId: string;
const ownerKey = randomUUID();
let commandGate: { entered: () => void; release: Promise<void> } | null = null;

function post(actor: string, path: string, body: object, key = randomUUID()) {
  return request(app.getHttpServer())
    .post(`/api/${path}`)
    .set('Authorization', `Bearer ${actors[actor].token}`)
    .set('Idempotency-Key', key)
    .send(body);
}
function get(actor: string, path: string) {
  return request(app.getHttpServer())
    .get(`/api/${path}`)
    .set('Authorization', `Bearer ${actors[actor].token}`);
}
function role(actor: string, target: string, code: string, chain?: string) {
  return post(actor, `organizations/${actors[target].org}/scoped-grants`, {
    userId: actors[target].id,
    role: code,
    ...(chain ? { chainId: chain } : {}),
  });
}

describe('Chain management with real PostgreSQL authorization and command journal', () => {
  beforeAll(async () => {
    for (const [key, code, type] of [
      ['owner', 'FARM_STAFF', 'FARM'],
      ['partner', 'TRANSPORTER', 'TRANSPORTER'],
      ['outsider', 'FARM_STAFF', 'FARM'],
      ['admin', 'SYSTEM_ADMIN', null],
    ] as const) {
      const org = type
        ? await prisma.organization.create({
            data: { name: `Chain test ${key} ${randomUUID()}`, type },
          })
        : null;
      const globalRole = await prisma.role.upsert({
        where: { code },
        create: { code, name: code },
        update: {},
      });
      const user = await prisma.user.create({
        data: {
          fullName: key,
          email: `chain-${randomUUID()}@example.test`,
          organizationId: org?.id,
          roleId: globalRole.id,
          passwordHash: 'test-only-unused-password',
        },
      });
      const session = await prisma.refreshSession.create({
        data: {
          userId: user.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      actors[key] = { id: user.id, org: org?.id ?? null, token: session.id };
    }
    const gated = prisma.$extends({
      query: {
        supplyChain: {
          async create({ args, query }) {
            if (commandGate && args.data.name === 'Revocation race') {
              commandGate.entered();
              await commandGate.release;
            }
            return query(args);
          },
        },
      },
    });
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(gated)
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: () => 'chain-tests-only-secret',
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
    class DiagnosticFilter extends GlobalExceptionFilter {
      override catch(error: unknown, host: ArgumentsHost) {
        if (!(error instanceof HttpException) && error instanceof Error)
          console.error(error.name, error.message.split('\n').at(-1));
        super.catch(error, host);
      }
    }
    app.useGlobalFilters(new DiagnosticFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.init();
    jwt = app.get(JwtService);
    for (const actor of Object.values(actors))
      actor.token = jwt.sign({ sub: actor.id, sid: actor.token });
    for (const target of ['owner', 'partner'])
      await role('admin', target, 'ORG_ADMIN').expect(201);
    await role('admin', 'owner', 'CREATE_CHAIN').expect(201);
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('requires explicit authority and rejects org-admin privilege escalation', async () => {
    await post('outsider', 'supply-chains', {
      name: 'Unauthorized chain',
    }).expect(403);
    await role('owner', 'owner', 'CREATE_CHAIN').expect(403);
    await role('owner', 'owner', 'AUDITOR', randomUUID()).expect(403);
    await role('owner', 'partner', 'FARM_STAFF', randomUUID()).expect(403);
    await post('owner', `organizations/${actors.owner.org}/capabilities`, {
      code: 'AUDITOR',
    }).expect(403);
    await post('owner', 'supply-chains', { name: '   ' }).expect(400);
  }, 30000);

  it('bootstraps exactly one owner membership and manager grant; replay survives unrelated grants', async () => {
    const created = await post(
      'owner',
      'supply-chains',
      { name: 'Owner and partners' },
      ownerKey,
    ).expect(201);
    chainId = created.body.data.id;
    await role('owner', 'owner', 'FARM_STAFF', chainId).expect(201);
    const replay = await post(
      'owner',
      'supply-chains',
      { name: 'Owner and partners' },
      ownerKey,
    ).expect(201);
    expect(replay.body.data.id).toBe(chainId);
    expect(
      await prisma.chainMembership.count({
        where: { chainId, organizationId: actors.owner.org! },
      }),
    ).toBe(1);
    expect(
      await prisma.chainAudit.count({
        where: { chainId, operation: 'CREATE_CHAIN' },
      }),
    ).toBe(1);
    await post(
      'owner',
      'supply-chains',
      { name: 'Different payload' },
      ownerKey,
    ).expect(409);
  }, 30000);

  it('hides unassigned chains and does not give an owner business authority over another organization', async () => {
    await get('outsider', `supply-chains/${chainId}`).expect(404);
    const list = await get('outsider', 'supply-chains').expect(200);
    expect(list.body.data).toEqual([]);
    await get(
      'outsider',
      `organizations/${actors.owner.org}/scoped-users`,
    ).expect(404);
    const roster = await get(
      'owner',
      `organizations/${actors.owner.org}/scoped-users`,
    ).expect(200);
    expect(Object.keys(roster.body.data[0]).sort()).toEqual(['fullName', 'id']);
    await get(
      'outsider',
      `organizations/${actors.owner.org}/scoped-grants`,
    ).expect(404);
    const grants = await get(
      'owner',
      `organizations/${actors.owner.org}/scoped-grants`,
    ).expect(200);
    expect(grants.body.data.length).toBeGreaterThan(0);
    expect(
      grants.body.data.every(
        (grant: { organizationId: string }) =>
          grant.organizationId === actors.owner.org,
      ),
    ).toBe(true);
    await post('outsider', `supply-chains/${chainId}/memberships`, {
      organizationId: actors.partner.org,
    }).expect(404);
    await post(
      'owner',
      `supply-chains/${chainId}/memberships/${actors.owner.org}/status`,
      { version: 0, status: 'REVOKED' },
    ).expect(403);
  }, 30000);

  it('requires the partner to accept, serializes duplicate acceptance, and masks other memberships', async () => {
    await post('owner', `supply-chains/${chainId}/memberships`, {
      organizationId: actors.partner.org,
    }).expect(201);
    await post(
      'owner',
      `supply-chains/${chainId}/memberships/${actors.partner.org}/accept`,
      { version: 0 },
    ).expect(403);
    const acceptanceKey = randomUUID();
    const path = `supply-chains/${chainId}/memberships/${actors.partner.org}/accept`;
    const responses = await Promise.all([
      post('partner', path, { version: 0 }, acceptanceKey),
      post('partner', path, { version: 0 }, acceptanceKey),
    ]);
    expect(responses.some((r) => r.status === 201)).toBe(true);
    expect(responses.every((r) => [201, 409].includes(r.status))).toBe(true);
    await post('partner', path, { version: 0 }, acceptanceKey).expect(201);
    const members = await get(
      'partner',
      `supply-chains/${chainId}/memberships`,
    ).expect(200);
    expect(members.body.data).toHaveLength(1);
    expect(members.body.data[0].organizationId).toBe(actors.partner.org);
    await role('partner', 'partner', 'TRANSPORTER', chainId).expect(201);
    await role('partner', 'partner', 'RETAILER', chainId).expect(403);
    await role('partner', 'partner', 'CHAIN_MANAGER', chainId).expect(403);

    await post(
      'owner',
      `supply-chains/${chainId}/memberships/${actors.partner.org}/status`,
      { version: 1, status: 'SUSPENDED' },
    ).expect(201);
    await post('partner', path, { version: 0 }, acceptanceKey).expect(403);
    expect(
      await prisma.scopedRoleGrant.count({
        where: {
          chainId,
          organizationId: actors.partner.org!,
          revokedAt: null,
        },
      }),
    ).toBe(0);
    await post(
      'owner',
      `supply-chains/${chainId}/memberships/${actors.partner.org}/status`,
      { version: 2, status: 'INVITED' },
    ).expect(201);
    await post('partner', path, { version: 0 }, acceptanceKey).expect(409);
    await post('partner', path, { version: 3 }).expect(201);
    expect(
      await prisma.scopedRoleGrant.count({
        where: {
          chainId,
          organizationId: actors.partner.org!,
          revokedAt: null,
        },
      }),
    ).toBe(0);
  }, 120000);

  it('prevents cross-org FK grants, duplicate NULL scopes, owner changes and audit rewrites in SQL', async () => {
    await expect(
      prisma.scopedRoleGrant.create({
        data: {
          userId: actors.outsider.id,
          organizationId: actors.outsider.org!,
          chainId,
          scope: 'CHAIN',
          role: 'FARM_STAFF',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.scopedRoleGrant.create({
        data: {
          userId: actors.partner.id,
          organizationId: actors.owner.org!,
          scope: 'ORGANIZATION',
          role: 'ORG_ADMIN',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.scopedRoleGrant.create({
        data: {
          userId: actors.owner.id,
          organizationId: actors.owner.org!,
          scope: 'ORGANIZATION',
          role: 'ORG_ADMIN',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.scopedRoleGrant.create({
        data: {
          userId: actors.owner.id,
          organizationId: actors.owner.org!,
          scope: 'CHAIN',
          role: 'ORG_ADMIN',
          chainId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.supplyChain.update({
        where: { id: chainId },
        data: { ownerOrganizationId: actors.partner.org! },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.supplyChain.create({
        data: {
          ownerOrganizationId: actors.owner.org!,
          name: 'Missing owner membership',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.chainAudit.updateMany({
        where: { chainId },
        data: { operation: 'REWRITTEN' },
      }),
    ).rejects.toThrow();
  }, 30000);

  it('serializes revocation with an in-flight command and denies subsequent writes/replays', async () => {
    const grant = await prisma.scopedRoleGrant.findFirstOrThrow({
      where: { userId: actors.owner.id, role: 'CREATE_CHAIN', revokedAt: null },
    });
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    commandGate = {
      entered,
      release: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const createFlight = post('owner', 'supply-chains', {
      name: 'Revocation race',
    }).then((value) => value);
    await enteredPromise;
    const revokeFlight = post(
      'admin',
      `organizations/${actors.owner.org}/scoped-grants/${grant.id}/revoke`,
      { version: 0 },
    ).then((value) => value);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 20 && !waiting; attempt++) {
        const key = `chain-scope:org:${actors.owner.org}`;
        const rows = await prisma.$queryRaw<
          Array<{ blocked: boolean }>
        >`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
          AND classid::bigint = ((hashtextextended(${key}, 0) >> 32) & 4294967295)
          AND objid::bigint = (hashtextextended(${key}, 0) & 4294967295)
        ) AS blocked`;
        waiting = rows[0].blocked;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(waiting).toBe(true);
      expect(
        (
          await prisma.scopedRoleGrant.findUniqueOrThrow({
            where: { id: grant.id },
          })
        ).revokedAt,
      ).toBeNull();
    } finally {
      release();
      commandGate = null;
    }
    const [created, revoked] = await Promise.all([createFlight, revokeFlight]);
    expect(created.status).toBe(201);
    expect(revoked.status).toBe(201);
    await post(
      'owner',
      'supply-chains',
      { name: 'Owner and partners' },
      ownerKey,
    ).expect(403);
    expect(
      await prisma.commandCommit.count({
        where: { requesterId: actors.owner.id, operation: 'HYB_CREATE_CHAIN' },
      }),
    ).toBe(2);
    await expect(
      prisma.scopedRoleGrant.update({
        where: { id: grant.id },
        data: { revokedAt: null, revision: 2 },
      }),
    ).rejects.toThrow();
  }, 60000);
});
