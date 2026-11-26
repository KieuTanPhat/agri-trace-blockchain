import { describe, expect, it, vi } from 'vitest';
import { lotCoverImage, productCoverImages } from './cover-image.js';

const lotPhoto = (id: string, entityId: string, extra: Record<string, unknown> = {}) => ({
  id, entityId, public: true, kind: 'LOT_IMAGE', mediaType: 'image/jpeg', supersedesId: null, withdrawal: null, ...extra,
});

function db(opts: {
  lotPhotos?: Record<string, ReturnType<typeof lotPhoto>[]>;
  productPhotos?: { id: string; entityId: string; supersedesId: string | null }[];
  order?: { productId: string; evidenceIds: string[] }[];
  runs?: Record<string, string | null>;
  inputs?: Record<string, string[]>;
  blocked?: string[];
  active?: string[];
}) {
  return {
    traceEvidence: {
      findMany: vi.fn(async (q: { where: { entityType: string; entityId: string | { in: string[] } } }) =>
        q.where.entityType === 'LOT'
          ? (opts.lotPhotos?.[q.where.entityId as string] ?? [])
          : (opts.productPhotos ?? []).filter((p) => (q.where.entityId as { in: string[] }).in.includes(p.entityId)),
      ),
    },
    productPhotoOrder: { findMany: vi.fn(async () => opts.order ?? []) },
    product: {
      findMany: vi.fn(async (q: { where: { id: { in: string[] } } }) =>
        q.where.id.in.filter((id) => (opts.active ?? ['product']).includes(id)).map((id) => ({ id })),
      ),
    },
    lot: {
      findMany: vi.fn(async (q: { where: { id: { in: string[] } } }) =>
        q.where.id.in.map((id) => ({ processingRunId: opts.runs?.[id] ?? null })),
      ),
    },
    processingInput: {
      findMany: vi.fn(async (q: { where: { runId: { in: string[] } } }) =>
        q.where.runId.in.flatMap((run) => (opts.inputs?.[run] ?? []).map((lotId) => ({ lotId }))),
      ),
    },
    traceQrBlock: {
      findMany: vi.fn(async () => (opts.blocked ?? []).map((lotId) => ({ lotId }))),
    },
  } as never;
}

describe('lot cover image', () => {
  it('always prefers the product photo over a lot photo', async () => {
    const d = db({ lotPhotos: { lot: [lotPhoto('own', 'lot')] }, productPhotos: [{ id: 'p1', entityId: 'product', supersedesId: null }] });
    expect(await lotCoverImage(d, { id: 'lot', productId: 'product' })).toEqual({ id: 'p1' });
  });

  it('uses the public lot photo when the product has none', async () => {
    const d = db({ active: [], lotPhotos: { lot: [lotPhoto('own', 'lot')] } });
    expect(await lotCoverImage(d, { id: 'lot', productId: 'product' })).toMatchObject({ id: 'own' });
  });

  it('falls back to the ordered main product photo, skipping replaced ones', async () => {
    const d = db({
      productPhotos: [
        { id: 'new', entityId: 'product', supersedesId: 'old' },
        { id: 'second', entityId: 'product', supersedesId: null },
        { id: 'old', entityId: 'product', supersedesId: null },
      ],
      order: [{ productId: 'product', evidenceIds: ['old', 'second', 'new'] }],
    });
    expect(await lotCoverImage(d, { id: 'lot', productId: 'product' })).toEqual({ id: 'second' });
  });

  it('never uses the photo of an inactive product', async () => {
    const d = db({ active: [], productPhotos: [{ id: 'p1', entityId: 'product', supersedesId: null }] });
    expect(await productCoverImages(d, ['product'])).toEqual(new Map());
  });

  it('falls back to a material lot photo, skipping lots with a blocked QR', async () => {
    const d = db({
      active: [],
      runs: { out: 'run', mid: 'run2' },
      inputs: { run: ['bad', 'mid'], run2: ['farm'] },
      blocked: ['bad'],
      lotPhotos: { bad: [lotPhoto('wrong', 'bad')], farm: [lotPhoto('field', 'farm')] },
    });
    expect(await lotCoverImage(d, { id: 'out', productId: 'product' })).toMatchObject({ id: 'field' });
  });

  it('returns nothing when no photo is public', async () => {
    const d = db({ active: [], lotPhotos: { lot: [lotPhoto('private', 'lot', { public: false })] } });
    expect(await lotCoverImage(d, { id: 'lot', productId: 'product' })).toBeNull();
  });
});
