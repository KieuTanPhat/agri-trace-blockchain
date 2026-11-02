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
  let logoId:string;
  let publicLotId: string;
  let privateLotId: string;
  let directoryChainId: string;

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
    directoryChainId = chainId;
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
    publicLotId = main.lot.id;
    const privateScanLot = await makeLot(publicId, farmOrg.id, farm.id, false);
    privateLotId = privateScanLot.lot.id;
    await db.traceScanDaily.createMany({ data: [
      { lotId: publicLotId, day: new Date('2026-10-01'), scans: 5 },
      { lotId: publicLotId, day: new Date('2026-10-02'), scans: 7 },
      { lotId: privateLotId, day: new Date('2026-10-01'), scans: 100 },
    ] });
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
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp3sAAAAASUVORK5CYII=','base64');
    const evidence=async(entityType:string,entityId:string,kind:string,isPublic:boolean)=>db.traceEvidence.create({data:{organizationId:farmOrgId,entityType,entityId,kind,public:isPublic,description:'Image publication fixture',fileName:'image.png',mediaType:'image/png',size:bytes.length,sha256:'ab'.repeat(32),content:bytes,actorId:submitter.id}});
    await evidence('LOT',main.lot.id,'LOT_IMAGE',true);
    logoId=(await evidence('PROFILE',farmOrgId,'OTHER',false)).id;
    await evidence('PROFILE',farmOrgId,'BUSINESS_LICENSE',false);
    await db.product.update({where:{id:publicId},data:{organizationId:farmOrgId,price:65000,category:'Trái cây tươi',ingredients:'100% trái cây',storageConditions:'Nơi khô thoáng',usageInstructions:'Rửa sạch trước khi dùng'}});
    await db.publicDirectoryPublication.create({data:{id:randomUUID(),organizationId:farmOrgId,presentation:{publicDirectory:{published:true,catalogDetailsPublished:true,phone:'02873001234',province:'Lâm Đồng',address:'12 đường số 1',logoEvidenceId:logoId}}}});
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
  it('serves real published images and allowlisted contact/catalog details without exposing legal files',async()=>{
    const detail=(await get(`products/${publicId}`).expect(200)).body.data;
    expect(detail).toMatchObject({price:'65000',category:'Trái cây tươi',imageUrl:expect.stringContaining(`/public/products/${publicId}/image?v=`),traceCount:1});
    const image=await get(`products/${publicId}/image`).expect(200);
    expect(image.headers['content-type']).toContain('image/png');expect(image.body.length).toBeGreaterThan(20);
    const org=(await get(`enterprises/${farmOrgId}`).expect(200)).body.data;
    expect(org).toMatchObject({phone:'02873001234',province:'Lâm Đồng',logoUrl:`/public/enterprises/${farmOrgId}/logo?v=${logoId}`});
    await get(`enterprises/${farmOrgId}/logo`).expect(200);
    const other=(await get(`enterprises/${transporterId}`).expect(200)).body.data;
    expect(other.phone).toBeNull();expect(other.logoUrl).toBeNull();
    await get(`products/${privateId}/image`).expect(404);
    await get(`enterprises/${privateOrgId}/logo`).expect(404);
  });
  it('anonymous lists exclude non-QR, inactive-product and inactive-org data', async () => {
    const response = await get(`products?q=${tag}`).expect(200);
    expect(response.body.data.items).toHaveLength(2);
    expect(response.headers['cache-control']).toBe('no-store');
    for (const id of [privateId, inactiveId, hiddenOrgProduct, randomUUID()])
      await get(`products/${id}`).expect(404);
  });
  it('aggregates all public daily scans without counting private lots of the same product', async () => {
    const detail = (await get(`products/${publicId}`).expect(200)).body.data;
    expect(detail.scanCount).toBe(12);
    expect(detail.traceCount).toBe(1);
    expect(detail.lots.items.map((lot: { id: string }) => lot.id)).toEqual([publicLotId]);
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
  it('rechecks publication revocation and private superseding images on every file request',async()=>{
    const snapshot=await db.publicDirectoryPublication.findFirstOrThrow({where:{organizationId:farmOrgId},orderBy:{createdAt:'desc'}});
    await db.publicDirectoryPublication.create({data:{id:randomUUID(),organizationId:farmOrgId,presentation:{publicDirectory:{published:false}},createdAt:new Date(Date.now()+1000)}});
    const org=(await get(`enterprises/${farmOrgId}`).expect(200)).body.data;
    expect(org.phone).toBeNull();expect(org.logoUrl).toBeNull();
    await get(`enterprises/${farmOrgId}/logo`).expect(404);
    await get(`enterprises/${farmOrgId}/logo?v=${logoId}`).expect(404);
    const product=(await get(`products/${publicId}`).expect(200)).body.data;
    expect(product.price).toBeNull();
    const image=await db.traceEvidence.findFirstOrThrow({where:{entityType:'LOT',kind:'LOT_IMAGE',public:true,organizationId:farmOrgId}});
    await db.traceEvidence.create({data:{...image,id:randomUUID(),public:false,supersedesId:image.id,createdAt:new Date()}});
    await get(`products/${publicId}/image`).expect(404);
    await get(`products/${publicId}/image?v=${image.id}`).expect(404);
    const after=(await get(`products/${publicId}`).expect(200)).body.data;
    expect(after.imageUrl).toBeNull();
    await db.publicDirectoryPublication.create({data:{id:randomUUID(),organizationId:farmOrgId,presentation:snapshot.presentation!,createdAt:new Date(Date.now()+2000)}});
  });
  it('relational distribution filters expose all three active parties only for non-cancelled public lots', async () => {
    const group = async (label: string, lotId: string, status: string) => {
      const parties = await Promise.all(['sender', 'carrier', 'receiver'].map((part) =>
        db.organization.create({ data: { name: `${tag}-${label}-${part}`, type: 'FARM' } }),
      ));
      await db.distributionTransfer.create({ data: {
        chainId: directoryChainId, senderId: parties[0].id, carrierId: parties[1].id,
        receiverId: parties[2].id, origin: 'Fixture origin', destination: 'Fixture destination', status,
        lines: { create: { lotId, quantity: '0.1', unit: 'kg' } },
      } });
      return parties;
    };
    const active = await group('active-distribution', publicLotId, 'PROPOSED');
    const cancelled = await group('cancelled-distribution', publicLotId, 'CANCELLED');
    const hidden = await group('private-distribution', privateLotId, 'PROPOSED');
    const ids = (await get(`enterprises?q=${tag}`).expect(200)).body.data.items
      .map((org: { id: string }) => org.id);
    const related = (await get(`products/${publicId}`).expect(200)).body.data.enterprises.items
      .map((org: { id: string }) => org.id);
    for (const org of active) {
      expect(ids).toContain(org.id);
      expect(related).toContain(org.id);
      const detail = (await get(`enterprises/${org.id}`).expect(200)).body.data;
      expect(detail.products.items.map((product: { id: string }) => product.id)).toContain(publicId);
    }
    for (const org of [...cancelled, ...hidden]) {
      expect(ids).not.toContain(org.id);
      expect(related).not.toContain(org.id);
      await get(`enterprises/${org.id}`).expect(404);
      await get(`enterprises/${org.id}/logo`).expect(404);
    }
    await db.organization.update({ where: { id: active[2].id }, data: { status: 'INACTIVE' } });
    await get(`enterprises/${active[2].id}`).expect(404);
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
