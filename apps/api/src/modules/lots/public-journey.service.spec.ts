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
  it('versions thumbnails by the current public evidence and never picks a withdrawn image',async()=>{
    const f=fixture(),base={id:photo,public:true,kind:'LOT_IMAGE',mediaType:'image/jpeg',supersedesId:null,withdrawal:null};
    f.db.traceEvidence.findMany.mockResolvedValue([base]);
    expect(await f.service.thumbnailUrl('trace',lotId)).toBe(`/public/trace/trace/thumbnail?v=${photo}`);
    const replacement='55555555-5555-4555-8555-555555555555';
    f.db.traceEvidence.findMany.mockResolvedValue([{...base,id:replacement,supersedesId:photo},base]);
    expect(await f.service.thumbnailUrl('trace',lotId)).toBe(`/public/trace/trace/thumbnail?v=${replacement}`);
    f.db.traceEvidence.findMany.mockResolvedValue([{...base,withdrawal:{evidenceId:photo}}]);
    expect(await f.service.thumbnailUrl('trace',lotId)).toBe('/public/trace/trace/thumbnail');
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
