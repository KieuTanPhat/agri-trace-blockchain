import {
  PublicJourneyService,
  publishedJourneyMedia,
} from './public-journey.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { PublicLot } from './lot-query.types.js';
const org = '11111111-1111-4111-8111-111111111111',
  lotId = '22222222-2222-4222-8222-222222222222',
  photo = '33333333-3333-4333-8333-333333333333',
  site = '44444444-4444-4444-8444-444444444444';
const snapshot = (traceMedia: unknown[]) => ({
  publicDirectory: {
    published: true,
    traceMedia,
    traceSites: [
      {
        id: site,
        name: 'Kho tại địa điểm A',
        address: 'Địa chỉ được công khai',
      },
    ],
  },
});
function fixture() {
  const lot = {
    id: lotId,
    farmOrgId: org,
    harvest: null,
    processingRun: null,
    initialStorageSiteId: site,
  } as unknown as PublicLot;
  const media = [
    {
      lotId,
      evidenceId: photo,
      groupKey: `site:${site}`,
      caption: 'Ảnh đúng lô',
    },
  ];
  const db = {
    shipment: { findUnique: vi.fn().mockResolvedValue(null) },
    organization: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: org,
          name: 'Công ty A',
          type: 'FARM',
          directoryPublications: [{ presentation: snapshot(media) }],
        },
      ]),
    },
    enterpriseSite: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: site, organizationId: org, farmId: null }]),
    },
    traceEvidence: {
      findMany: vi
        .fn()
        .mockImplementation(async (q: { where: { id?: unknown } }) =>
          q.where.id
            ? [
                {
                  id: photo,
                  organizationId: org,
                  entityType: 'LOT',
                  entityId: lotId,
                  kind: 'LOT_IMAGE',
                },
              ]
            : [],
        ),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        content: Buffer.from('image'),
        mediaType: 'image/jpeg',
      }),
    },
    certificate: { findMany: vi.fn().mockResolvedValue([]) },
    distributionLine: { findMany: vi.fn().mockResolvedValue([]) },
    traceQr: { findUnique: vi.fn().mockResolvedValue({ lotId, lot }) },
    careRecord: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    db,
    lot,
    service: new PublicJourneyService(db as unknown as PrismaService),
  };
}
describe('Public journey boundaries', () => {
  it('shows only the source lot way to the processor, not parts sent to shops', async () => {
    const f = fixture();
    const supplier = '66666666-6666-4666-8666-666666666666',
      shop = '77777777-7777-4777-8777-777777777777',
      source = '88888888-8888-4888-8888-888888888888';
    const started = new Date('2026-11-25T15:29:00Z');
    const transfer = (id: string, receiverId: string, deliveredAt: string) => ({
      transferId: id,
      lotId: source,
      transfer: {
        id, senderId: supplier, receiverId, carrierId: supplier,
        senderSiteId: null, receiverSiteId: null, carrierSiteId: null,
        status: 'DELIVERED', transportMode: 'SELF',
        createdAt: new Date(new Date(deliveredAt).getTime() - 3_600_000),
        deliveredAt: new Date(deliveredAt),
      },
    });
    f.db.organization.findMany.mockResolvedValue([
      { id: org, name: 'Xưởng chế biến', type: 'PROCESSOR', directoryPublications: [] },
      { id: supplier, name: 'Nhà cung cấp', type: 'PROCESSOR', directoryPublications: [] },
      { id: shop, name: 'Cửa hàng khác', type: 'RETAILER', directoryPublications: [] },
    ]);
    f.db.enterpriseSite.findMany.mockResolvedValue([]);
    f.db.distributionLine.findMany.mockResolvedValue([
      transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', org, '2026-11-07T08:00:00Z'),
      transfer('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', shop, '2026-11-10T08:00:00Z'),
    ]);
    Object.assign(f.db, {
      lot: { findMany: vi.fn().mockResolvedValue([{
        id: source, farmOrgId: supplier, harvest: null, processingRun: null,
        initialStorageSiteId: null, traceQr: { traceToken: 'source' },
      }]) },
      traceEvent: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const output = {
      ...f.lot, initialStorageSiteId: null, initialQuantity: '10', unit: 'kg',
      processingRun: {
        code: 'PR-1', siteId: null, organizationId: org, startedAt: started,
        createdAt: started, inputs: [{ lotId: source }],
      },
    } as unknown as PublicLot;
    const groups = await f.service.build(output, [], [], 'trace');
    const titles = groups.map((g) => g.title);
    expect(titles).toContain('Xưởng chế biến');
    expect(titles).not.toContain('Cửa hàng khác');
  });
  it('versions thumbnails by the current public evidence and never picks a withdrawn image',async()=>{
    const f=fixture(),base={id:photo,public:true,kind:'LOT_IMAGE',mediaType:'image/jpeg',supersedesId:null,withdrawal:null};
    Object.assign(f.db,{product:{findMany:vi.fn().mockResolvedValue([])},lot:{findMany:vi.fn().mockResolvedValue([])}});
    f.db.traceEvidence.findMany.mockResolvedValue([base]);
    expect(await f.service.thumbnailUrl('trace',{id:lotId,productId:'product'})).toBe(`/public/trace/trace/thumbnail?v=${photo}`);
    const replacement='55555555-5555-4555-8555-555555555555';
    f.db.traceEvidence.findMany.mockResolvedValue([{...base,id:replacement,supersedesId:photo},base]);
    expect(await f.service.thumbnailUrl('trace',{id:lotId,productId:'product'})).toBe(`/public/trace/trace/thumbnail?v=${replacement}`);
    f.db.traceEvidence.findMany.mockResolvedValue([{...base,withdrawal:{evidenceId:photo}}]);
    expect(await f.service.thumbnailUrl('trace',{id:lotId,productId:'product'})).toBe('/public/trace/trace/thumbnail');
    await expect(f.service.image('trace')).rejects.toMatchObject({status:404});
  });
  it('keeps separate farms of the same company in separate location groups', async () => {
    const f = fixture();
    const harvest = (id: string) => ({
      id: 'harvest',
      cycleId: 'cycle',
      harvestTime: new Date(),
      quantity: 10,
      unit: 'kg',
      cycle: {
        id: 'cycle',
        farmId: id,
        name: 'Mùa vụ',
        cycleCode: 'V01',
        farm: { privacy: 'PUBLIC', name: 'Vườn ' + id },
      },
    });
    const a = await f.service.build(
      { ...f.lot, harvest: harvest('A') } as unknown as PublicLot,
      [],
      [],
      'a',
    );
    const b = await f.service.build(
      { ...f.lot, harvest: harvest('B') } as unknown as PublicLot,
      [],
      [],
      'b',
    );
    expect(a[0]).toMatchObject({ id: 'farm:A', title: 'Vườn A' });
    expect(b[0]).toMatchObject({ id: 'farm:B', title: 'Vườn B' });
  });
  it('uses explicit current publication and exact lot ids', () => {
    expect(
      publishedJourneyMedia(
        snapshot([{ lotId: 'other', evidenceId: photo, groupKey: 'org:a' }]),
        lotId,
        org,
      ),
    ).toEqual([]);
    expect(
      publishedJourneyMedia(
        {
          publicDirectory: {
            published: false,
            traceMedia: [{ lotId, evidenceId: photo, groupKey: 'org:a' }],
          },
        },
        lotId,
        org,
      ),
    ).toEqual([]);
  });
  it('groups the published photos under the correct location and rechecks withdrawal of publication', async () => {
    const f = fixture();
    const result = await f.service.build(f.lot, [], [], 'trace');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: `site:${site}`,
      title: 'Kho tại địa điểm A',
      photos: [{ id: photo, caption: 'Ảnh đúng lô' }],
    });
    await expect(f.service.image('trace', photo)).resolves.toHaveProperty(
      'mediaType',
      'image/jpeg',
    );
    f.db.organization.findMany.mockResolvedValue([
      {
        id: org,
        name: 'Công ty A',
        type: 'FARM',
        directoryPublications: [
          { presentation: { publicDirectory: { published: false } } },
        ],
      },
    ]);
    await expect(f.service.image('trace', photo)).rejects.toMatchObject({
      status: 404,
    });
  });
  describe('handover photos', () => {
    const carrier = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      transferId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      handover = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    function transferFixture(details: boolean) {
      const f = fixture();
      f.db.organization.findMany.mockResolvedValue([
        { id: org, name: 'Công ty A', type: 'FARM', directoryPublications: [] },
        { id: carrier, name: 'Vận tải B', type: 'TRANSPORTER', directoryPublications: [{ presentation: { publicDirectory: { published: true, traceDetailsPublished: details } } }] },
      ]);
      f.db.enterpriseSite.findMany.mockResolvedValue([]);
      f.db.traceEvidence.findMany.mockImplementation(
        async (q: { where: { id?: { in: string[] }; supersedesId?: unknown; entityType?: string } }) => {
          if (q.where.supersedesId) return [];
          const row = { id: handover, entityId: transferId, organizationId: carrier, supersedesId: null, entityType: 'TRANSFER', kind: 'TRANSFER_IMAGE' };
          if (q.where.entityType === 'TRANSFER') return [row];
          return q.where.id ? [row].filter((r) => q.where.id!.in.includes(r.id)) : [];
        },
      );
      const line = {
        lotId, transferId, quantity: '10',
        transfer: { id: transferId, status: 'DELIVERED', senderId: org, carrierId: carrier, receiverId: org, senderSiteId: null, carrierSiteId: null, receiverSiteId: null, createdAt: new Date(), updatedAt: new Date() },
      };
      return { ...f, lines: [line] as never };
    }
    it('shows pickup and delivery photos under the party that took them', async () => {
      const f = transferFixture(true);
      const groups = await f.service.build(f.lot, [], f.lines, 'trace');
      const carrierGroup = groups.find((g) => g.id === `org:${carrier}`);
      expect(carrierGroup?.photos).toEqual([{ id: handover, url: `/public/trace/trace/media/${handover}`, caption: 'Bàn giao hàng' }]);
    });
    it('keeps handover photos private when the company does not publish trace details', async () => {
      const f = transferFixture(false);
      const groups = await f.service.build(f.lot, [], f.lines, 'trace');
      expect(groups.flatMap((g) => g.photos).map((p) => p.id)).not.toContain(handover);
    });
  });
  describe('photos recorded by the farm', () => {
    const cycleId = '66666666-6666-4666-8666-666666666666',
      carePhoto = '77777777-7777-4777-8777-777777777777',
      lateCarePhoto = '88888888-8888-4888-8888-888888888888',
      harvestPhoto = '99999999-9999-4999-8999-999999999999',
      corrected = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      harvestTime = new Date('2026-11-23T10:00:00Z');
    type Row = { id: string; supersedesId?: string | null; kind: string };
    function farmFixture(opts: { privacy?: string; details?: boolean; rows?: Row[] } = {}) {
      const f = fixture();
      const rows: Row[] = opts.rows ?? [
        { id: carePhoto, kind: 'CARE_IMAGE' },
        { id: lateCarePhoto, kind: 'CARE_IMAGE' },
        { id: harvestPhoto, kind: 'HARVEST_IMAGE' },
      ];
      f.db.organization.findMany.mockResolvedValue([
        {
          id: org,
          name: 'Công ty A',
          type: 'FARM',
          directoryPublications: [
            { presentation: { publicDirectory: { published: true, traceDetailsPublished: opts.details ?? true } } },
          ],
        },
      ]);
      f.db.enterpriseSite.findMany.mockResolvedValue([]);
      // The service asks only for care up to the harvest; the late log is excluded there.
      f.db.careRecord.findMany.mockImplementation(async (q: { where: { eventTime: { lte: Date } } }) =>
        [
          { id: 'care-1', name: 'Tỉa cành', eventTime: new Date('2026-10-01T00:00:00Z'), evidenceIds: [carePhoto] },
          { id: 'care-2', name: 'Tích hợp IOT', eventTime: new Date('2026-11-24T00:00:00Z'), evidenceIds: [lateCarePhoto] },
        ].filter((c) => c.eventTime <= q.where.eventTime.lte),
      );
      f.db.traceEvidence.findMany.mockImplementation(
        async (q: { where: { id?: { in: string[] }; supersedesId?: { in: string[] } } }) => {
          if (q.where.supersedesId) return [];
          const all = rows.map((r) => ({
            ...r,
            supersedesId: r.supersedesId ?? null,
            organizationId: org,
            entityType: 'CYCLE',
            entityId: cycleId,
          }));
          return q.where.id ? all.filter((r) => q.where.id!.in.includes(r.id)) : all;
        },
      );
      const lot = {
        ...f.lot,
        initialStorageSiteId: null,
        harvest: {
          id: 'harvest',
          cycleId,
          harvestTime,
          quantity: 100,
          unit: 'kg',
          evidenceIds: [harvestPhoto],
          cycle: { id: cycleId, farmId: 'farm-1', name: 'Lựu - vụ 2026', cycleCode: 'VU-LUU45', farm: { privacy: opts.privacy ?? 'PUBLIC', name: 'Vùng Đơn Dương' } },
        },
      } as unknown as PublicLot;
      f.db.traceQr.findUnique.mockResolvedValue({ lotId, lot });
      return { ...f, lot };
    }
    it('shows care photos up to the harvest and this harvest photo in the farm stage', async () => {
      const f = farmFixture();
      const [farm] = await f.service.build(f.lot, [], [], 'trace');
      expect(farm).toMatchObject({ id: 'farm:farm-1', stage: 'Trồng và thu hoạch' });
      expect(farm.photos).toEqual([
        { id: carePhoto, url: `/public/trace/trace/media/${carePhoto}`, caption: 'Tỉa cành' },
        { id: harvestPhoto, url: `/public/trace/trace/media/${harvestPhoto}`, caption: 'Thu hoạch' },
      ]);
      await expect(f.service.image('trace', carePhoto)).resolves.toHaveProperty('mediaType', 'image/jpeg');
      await expect(f.service.image('trace', lateCarePhoto)).rejects.toMatchObject({ status: 404 });
    });
    it('shows the current replacement of a corrected photo', async () => {
      const f = farmFixture({
        rows: [
          { id: carePhoto, kind: 'CARE_IMAGE' },
          { id: corrected, kind: 'CARE_IMAGE', supersedesId: carePhoto },
          { id: harvestPhoto, kind: 'HARVEST_IMAGE' },
        ],
      });
      const [farm] = await f.service.build(f.lot, [], [], 'trace');
      expect(farm.photos.map((p) => p.id)).toEqual([corrected, harvestPhoto]);
    });
    it.each([
      { privacy: 'PRIVATE', details: true },
      { privacy: 'PUBLIC', details: false },
    ])('keeps recorded photos private when privacy=$privacy details=$details', async (opts) => {
      const f = farmFixture(opts);
      const groups = await f.service.build(f.lot, [], [], 'trace');
      expect(groups.flatMap((g) => g.photos)).toEqual([]);
      await expect(f.service.image('trace', carePhoto)).rejects.toMatchObject({ status: 404 });
    });
    it('leaves care logged after the harvest out of this lot', async () => {
      const f = farmFixture();
      const event = (id: string, eventType: string, eventTime: Date, lot: string | null = null) =>
        ({ id, eventType, eventTime, lotId: lot, entityId: id, businessData: {}, actorOrganizationId: org }) as never;
      const [farm] = await f.service.build(
        f.lot,
        [
          event('before', 'CARE_RECORDED', new Date('2026-10-01T00:00:00Z')),
          event('harvest', 'HARVEST_RECORDED', harvestTime, lotId),
          event('after', 'CARE_RECORDED', new Date('2026-11-24T00:00:00Z')),
        ],
        [],
        'trace',
      );
      expect(farm.entries.map((e) => e.id)).toEqual(['before', 'harvest']);
    });
  });
  it.each([
    { entityType: 'LOT', entityId: 'sibling', kind: 'LOT_IMAGE' },
    { entityType: 'FARM', entityId: site, kind: 'LAND_CERTIFICATE' },
    { entityType: 'PROFILE', entityId: org, kind: 'BUSINESS_LICENSE' },
  ])('rejects sibling/private document media: $kind', async (extra) => {
    const f = fixture();
    f.db.traceEvidence.findMany.mockImplementation(
      async (q: { where: { id?: unknown } }) =>
        q.where.id ? [{ id: photo, organizationId: org, ...extra }] : [],
    );
    await expect(f.service.image('trace', photo)).rejects.toMatchObject({
      status: 404,
    });
    expect(f.db.traceEvidence.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
