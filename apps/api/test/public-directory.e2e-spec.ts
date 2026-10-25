import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ApiResponseInterceptor } from '../src/common/api/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/exception/global-exception.filter.js';
import { PublicDirectoryModule } from '../src/modules/public-directory/public-directory.module.js';
import { provisionChain } from './support/chain-scope.js';

// Isolated read-projection fixtures, not evidence of a production/Fabric workflow.
describe('Public directory / real PostgreSQL and HTTP', () => {
  const connectionString = process.env.TEST_DATABASE_URL!;
  const target = new URL(connectionString);
  if (
    !['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) ||
    !/(test|_ci)/i.test(target.pathname)
  )
    throw new Error('Use a local isolated test/CI database');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const tag = `PD-${randomUUID()}`;
  let app: INestApplication;
  let publicId: string;
  let privateId: string;
  let inactiveId: string;
  let hiddenOrgProduct: string;
  let farmOrgId: string;
  let privateOrgId: string;
  let transporterId: string;
  let retailerId: string;
  let revokedOrgId: string;
  let approvedCertificateId: string;
  let replacementId: string;
  let sourceLotId: string;
  let sourceCycleId: string;
  let sourceChainId: string;
  let fixtureActorId: string;

  beforeAll(async () => {
    const org = async (
      name: string,
      type: 'FARM' | 'TRANSPORTER' | 'RETAILER' | 'AUDITOR' = 'FARM',
    ) => db.organization.create({ data: { name: `${tag} ${name}`, type } });
    const farmOrg = await org('Farm');
    farmOrgId = farmOrg.id;
    const hidden = await org('Revoked');
    revokedOrgId = hidden.id;
    const transport = await org('Transport', 'TRANSPORTER');
    transporterId = transport.id;
    const retail = await org('Retail', 'RETAILER');
    retailerId = retail.id;
    privateOrgId = (await org('Private', 'AUDITOR')).id;
    const reviewer = await org('Reviewer', 'AUDITOR');
    const createProduct = (
      name: string,
      status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
    ) =>
      db.product.create({
        data: {
          productName: `${tag} ${name}`,
          variety: 'Giống kiểm thử',
          defaultUnit: 'kg',
          description: 'Public description',
          status,
        },
      });
    publicId = (await createProduct('A')).id;
    const secondId = (await createProduct('B')).id;
    privateId = (await createProduct('NoQR')).id;
    inactiveId = (await createProduct('Inactive', 'INACTIVE')).id;
    hiddenOrgProduct = (await createProduct('InactiveOrg')).id;
    const farm = await db.farm.create({
      data: { organizationId: farmOrg.id, name: `${tag} farm` },
    });
    const hiddenFarm = await db.farm.create({
      data: { organizationId: hidden.id, name: `${tag} hidden farm` },
    });
    const chainId = await provisionChain(db, {
      ownerOrganizationId: farmOrg.id,
      memberOrganizationIds: [
        hidden.id,
        transport.id,
        retail.id,
        reviewer.id,
        privateOrgId,
      ],
      grants: [],
    });
    const makeLot = async (
      productId: string,
      organizationId: string,
      farmId: string,
      qr: boolean,
    ) => {
      const cycle = await db.productionCycle.create({
        data: {
          cycleCode: randomUUID(),
          productId,
          farmId,
          farmOrgId: organizationId,
          chainId,
          currentState: 'PLANTED',
        },
      });
      const harvest = await db.harvestEvent.create({
        data: {
          cycleId: cycle.id,
          harvestTime: new Date(),
          quantity: 1,
          unit: 'kg',
        },
      });
      const lot = await db.lot.create({
        data: {
          lotCode: `PD-${randomUUID()}`,
          harvestId: harvest.id,
          productId,
          farmOrgId: organizationId,
          initialQuantity: 1,
          availableQuantity: 1,
          unit: 'kg',
          expiryDate: new Date('2020-01-01'),
        },
      });
      if (qr)
        await db.traceQr.create({
          data: {
            lotId: lot.id,
            traceToken: randomUUID().replaceAll('-', ''),
            traceUrl: 'https://example.invalid/trace/test',
          },
        });
      return { lot, cycle };
    };
    const main = await makeLot(publicId, farmOrg.id, farm.id, true);
    sourceLotId = main.lot.id;
    sourceCycleId = main.cycle.id;
    sourceChainId = chainId;
    await makeLot(secondId, farmOrg.id, farm.id, true);
    await makeLot(privateId, farmOrg.id, farm.id, false);
    await makeLot(inactiveId, farmOrg.id, farm.id, true);
    await makeLot(hiddenOrgProduct, hidden.id, hiddenFarm.id, true);
    await db.organization.update({
      where: { id: hidden.id },
      data: { status: 'INACTIVE' },
    });
    await db.shipment.create({
      data: {
        lotId: main.lot.id,
        transporterOrgId: transport.id,
        retailerOrgId: retail.id,
        origin: 'Public origin',
        destination: 'Public destination',
        shippedQuantity: 1,
        unit: 'kg',
      },
    });
    const role = await db.role.upsert({
      where: { code: 'FARM_STAFF' },
      update: {},
      create: { code: 'FARM_STAFF', name: 'Farm' },
    });
    const reviewRole = await db.role.upsert({
      where: { code: 'COMPLIANCE_REVIEWER' },
      update: {},
      create: { code: 'COMPLIANCE_REVIEWER', name: 'Reviewer' },
    });
    const submitter = await db.user.create({
      data: {
        email: `pd-${randomUUID()}@example.test`,
        fullName: 'Fixture submitter',
        passwordHash: 'not-a-login',
        roleId: role.id,
        organizationId: farmOrg.id,
      },
    });
    const reviewUser = await db.user.create({
      data: {
        email: `pd-${randomUUID()}@example.test`,
        fullName: 'Fixture reviewer',
        passwordHash: 'not-a-login',
        roleId: reviewRole.id,
        organizationId: reviewer.id,
      },
    });
    fixtureActorId = submitter.id;
    const certificate = async (options: {
      isPublic?: boolean;
      status?: 'APPROVED' | 'PENDING' | 'REJECTED';
      issueDate?: Date;
      expiryDate?: Date;
      supersedesId?: string;
      cycleId?: string;
    }) => {
      const row = await db.certificate.create({
        data: {
          ...(options.cycleId
            ? { cycleId: options.cycleId }
            : { lotId: main.lot.id }),
          type: 'TEST-CERT',
          issuer: 'Fixture issuer',
          issueDate: options.issueDate ?? new Date('2020-01-01'),
          expiryDate: options.expiryDate ?? null,
          documentRef: 'private://DO-NOT-PUBLISH',
          documentHash: 'ab'.repeat(32),
          isPublic: options.isPublic ?? true,
          submittedByUserId: submitter.id,
          ...(options.supersedesId
            ? {
                supersedesId: options.supersedesId,
                correctionReason: 'Fixture replacement',
              }
            : {}),
        },
      });
      if ((options.status ?? 'APPROVED') !== 'PENDING')
        await db.certificate.update({
          where: { id: row.id },
          data: {
            status: options.status ?? 'APPROVED',
            reviewedBy: reviewUser.id,
            reviewedAt: new Date(),
            reviewNote: 'PRIVATE_REVIEW_NOTE',
            version: 1,
          },
        });
      return row.id;
    };
    approvedCertificateId = await certificate({});
    await certificate({ isPublic: false });
    await certificate({ status: 'PENDING' });
    await certificate({ status: 'REJECTED' });
    await certificate({ expiryDate: new Date('2020-01-02') });
    await certificate({ issueDate: new Date(Date.now() + 7 * 86400000) });
    const superseded = await certificate({});
    replacementId = await certificate({ supersedesId: superseded });
    await certificate({ cycleId: main.cycle.id });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }]),
        PublicDirectoryModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });
  const get = (path: string) =>
    request(app.getHttpServer()).get(`/api/public/${path}`);
  it('anonymous lists exclude non-QR, inactive-product and inactive-org data', async () => {
    const response = await get(`products?q=${tag}`).expect(200);
    expect(response.body.data.items).toHaveLength(2);
    expect(response.headers['cache-control']).toBe('no-store');
    for (const id of [privateId, inactiveId, hiddenOrgProduct, randomUUID()])
      await get(`products/${id}`).expect(404);
  });
  it('paginates lists and detail links without duplicates', async () => {
    const first = (await get(`products?q=${tag}&limit=1`).expect(200)).body
      .data;
    expect(first.hasMore).toBe(true);
    const second = (
      await get(`products?q=${tag}&limit=1&cursor=${first.nextCursor}`).expect(
        200,
      )
    ).body.data;
    expect(second.hasMore).toBe(false);
    expect(first.items[0].id).not.toBe(second.items[0].id);
    const detail = (await get(`products/${publicId}?limit=1`).expect(200)).body
      .data;
    expect(detail.lots.items).toHaveLength(1); // Expiry does not hide safety warnings.
    expect(detail.enterprises.hasMore).toBe(true);
    const next = (
      await get(
        `products/${publicId}?limit=1&enterpriseCursor=${detail.enterprises.nextCursor}`,
      ).expect(200)
    ).body.data;
    expect(next.enterprises.items[0].id).not.toBe(
      detail.enterprises.items[0].id,
    );
  });
  it('lists direct farm/transporter/retailer but not unrelated chain members', async () => {
    const items = (await get(`enterprises?q=${tag}`).expect(200)).body.data
      .items;
    expect(items.map((item: { id: string }) => item.id).sort()).toEqual(
      [farmOrgId, transporterId, retailerId].sort(),
    );
    await get(`enterprises/${privateOrgId}`).expect(404);
    await get(`enterprises/${revokedOrgId}`).expect(404);
    const filtered = (
      await get(`enterprises?q=${tag}&type=TRANSPORTER`).expect(200)
    ).body.data.items;
    expect(filtered.map((item: { id: string }) => item.id)).toEqual([
      transporterId,
    ]);
  });
  it('only publishes effective approved, public, valid lot/cycle certificates', async () => {
    const detail = (await get(`enterprises/${farmOrgId}`).expect(200)).body
      .data;
    const certificates = detail.certificates.items;
    expect(certificates).toHaveLength(3);
    expect(certificates.map((item: { id: string }) => item.id)).toContain(
      approvedCertificateId,
    );
    expect(certificates.map((item: { id: string }) => item.id)).toContain(
      replacementId,
    );
    const serialized = JSON.stringify(detail);
    for (const forbidden of [
      'documentRef',
      'reviewNote',
      'email',
      'passwordHash',
      'enterpriseEnrollment',
      'private://DO-NOT-PUBLISH',
      'PRIVATE_REVIEW_NOTE',
    ])
      expect(serialized).not.toContain(forbidden);
    const first = (await get(`enterprises/${farmOrgId}?limit=1`).expect(200))
      .body.data;
    expect(first.products.hasMore).toBe(true);
    expect(first.certificates.hasMore).toBe(true);
  });
  it('rejects invalid queries and returns an explicit empty page', async () => {
    for (const path of [
      'products?limit=51',
      'products?cursor=bad',
      'products?limit=1.5',
      'enterprises?type=ADMIN',
      `products?q=${'x'.repeat(101)}`,
      'products?unknown=value',
      'products/not-uuid',
    ])
      await get(path).expect(400);
    const empty = (await get(`products?q=${randomUUID()}`).expect(200)).body
      .data;
    expect(empty).toEqual({ items: [], hasMore: false, nextCursor: null });
    const literal = (
      await get(`products?q=${encodeURIComponent(`${tag}%`)}`).expect(200)
    ).body.data;
    expect(literal.items).toEqual([]);
  });
  it('publishes completed processed lots and their processor without inventing a harvest', async () => {
    const processor = await db.organization.create({
      data: { name: `${tag} processor`, type: 'PROCESSOR' },
    });
    const site = await db.enterpriseSite.create({
      data: {
        organizationId: processor.id,
        name: 'Test processing site',
        kind: 'PROCESSING',
        address: 'Fixture only',
      },
    });
    const product = await db.product.create({
      data: {
        organizationId: processor.id,
        productName: `${tag} processed`,
        defaultUnit: 'kg',
      },
    });
    const run = await db.processingRun.create({
      data: {
        code: `PD-${randomUUID()}`.slice(0, 40),
        organizationId: processor.id,
        chainId: sourceChainId,
        siteId: site.id,
        processType: 'DRYING',
        baseUnit: 'kg',
        createdBy: fixtureActorId,
      },
    });
    await db.processingInput.create({
      data: { runId: run.id, lotId: sourceLotId, quantity: 1, unit: 'kg' },
    });
    const output = await db.processingOutput.create({
      data: {
        runId: run.id,
        productId: product.id,
        kind: 'PRODUCT',
        quantity: 1,
        baseQuantity: 1,
        unit: 'kg',
      },
    });
    const lot = await db.lot.create({
      data: {
        lotCode: `PD-${randomUUID()}`,
        originType: 'TRANSFORMATION',
        processingRunId: run.id,
        productId: product.id,
        farmOrgId: processor.id,
        initialQuantity: 1,
        availableQuantity: 1,
        unit: 'kg',
      },
    });
    await db.processingOutput.update({
      where: { id: output.id },
      data: { lotId: lot.id },
    });
    await db.traceQr.create({
      data: {
        lotId: lot.id,
        traceToken: randomUUID().replaceAll('-', ''),
        traceUrl: 'https://example.invalid/trace/processed',
      },
    });
    await get(`products/${product.id}`).expect(404);
    await db.processingRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        originCycleId: sourceCycleId,
        inputTotal: 1,
        outputTotal: 1,
        lossTotal: 0,
        version: 1,
      },
    });
    const detail = (await get(`products/${product.id}`).expect(200)).body.data;
    expect(detail.lots.items.map((item: { id: string }) => item.id)).toContain(
      lot.id,
    );
    expect(
      detail.enterprises.items.map((item: { id: string }) => item.id),
    ).toContain(processor.id);
    const processors = (
      await get(`enterprises?q=${tag}&type=PROCESSOR`).expect(200)
    ).body.data.items;
    expect(processors.map((item: { id: string }) => item.id)).toContain(
      processor.id,
    );
    await db.organization.update({
      where: { id: processor.id },
      data: { status: 'INACTIVE' },
    });
    await get(`products/${product.id}`).expect(404);
    await get(`enterprises/${processor.id}`).expect(404);
  });
  it('includes only current distribution parties of visible source lots', async () => {
    const carrier = await db.organization.create({
      data: { name: `${tag} current carrier`, type: 'TRANSPORTER' },
    });
    const receiver = await db.organization.create({
      data: { name: `${tag} current receiver`, type: 'DISTRIBUTOR' },
    });
    const excluded = await db.organization.create({
      data: { name: `${tag} cancelled receiver`, type: 'DISTRIBUTOR' },
    });
    for (const [receiverId, status] of [
      [receiver.id, 'PROPOSED'],
      [excluded.id, 'CANCELLED'],
    ] as const)
      await db.distributionTransfer.create({
        data: {
          chainId: sourceChainId,
          senderId: farmOrgId,
          carrierId: carrier.id,
          receiverId,
          status,
          origin: 'Fixture origin',
          destination: 'Fixture destination',
          lines: { create: { lotId: sourceLotId, quantity: 1, unit: 'kg' } },
        },
      });
    const list = (
      await get(`enterprises?q=${tag}`).expect(200)
    ).body.data.items.map((item: { id: string }) => item.id);
    expect(list).toContain(carrier.id);
    expect(list).toContain(receiver.id);
    expect(list).not.toContain(excluded.id);
    await get(`enterprises/${excluded.id}`).expect(404);
    const detail = (await get(`enterprises/${receiver.id}`).expect(200)).body
      .data;
    expect(
      detail.products.items.map((item: { id: string }) => item.id),
    ).toContain(publicId);
    const product = (await get(`products/${publicId}`).expect(200)).body.data;
    expect(product.lots.items.map((item: { id: string }) => item.id)).toContain(sourceLotId);
    expect(
      product.enterprises.items.map((item: { id: string }) => item.id),
    ).toContain(receiver.id);
    const filtered = (
      await get(`enterprises?q=${tag}&type=DISTRIBUTOR`).expect(200)
    ).body.data.items;
    expect(filtered.map((item: { id: string }) => item.id)).toEqual([
      receiver.id,
    ]);
  });
  it('rate-limits anonymous requests without returning private error data', async () => {
    let status = 200;
    for (let attempt = 0; attempt < 61 && status === 200; attempt++) {
      const response = await get(`products?q=${tag}`);
      status = response.status;
      if (status === 429) {
        expect(JSON.stringify(response.body)).not.toContain('DATABASE_URL');
        expect(JSON.stringify(response.body)).not.toContain('password');
      }
    }
    expect(status).toBe(429);
  });
});
