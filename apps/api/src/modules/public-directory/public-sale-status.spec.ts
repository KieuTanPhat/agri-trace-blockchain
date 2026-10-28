import { Prisma } from '../../generated/prisma/client.js';
import { hasSaleableStock, sellingLots } from './public-sale-status.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
const d = (v: number) => new Prisma.Decimal(v);
describe('Public selling status', () => {
  it('excludes reserved and quarantined quantities', () => {
    expect(
      hasSaleableStock({ quantity: d(10), reserved: d(5), quarantined: d(5) }),
    ).toBe(false);
    expect(
      hasSaleableStock({ quantity: d(11), reserved: d(5), quarantined: d(5) }),
    ).toBe(true);
  });
  function fixture() {
    return {
      lot: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              id: 'lot',
              currentState: 'HARVESTED',
              availableQuantity: d(100),
              shipment: null,
            },
          ]),
      },
      organization: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'shop-1' }, { id: 'shop-2' }]),
      },
      lotHolding: {
        findMany: vi.fn().mockResolvedValue([
          {
            lotId: 'lot',
            organizationId: 'shop-1',
            quantity: d(0),
            reserved: d(0),
          },
          {
            lotId: 'lot',
            organizationId: 'shop-2',
            quantity: d(3),
            reserved: d(0),
          },
        ]),
      },
      lotSiteHolding: { findMany: vi.fn().mockResolvedValue([]) },
      traceNotice: { findMany: vi.fn().mockResolvedValue([]) },
    };
  }
  it('needs only one eligible retailer, ignores another empty store', async () => {
    const db = fixture();
    expect(await sellingLots(db as unknown as PrismaService, ['p'])).toEqual(
      new Set(['lot']),
    );
  });
  it('never falls back to global lot quantity after retail holdings are exhausted', async () => {
    const db = fixture();
    db.lotHolding.findMany.mockResolvedValue([
      {
        lotId: 'lot',
        organizationId: 'shop-1',
        quantity: d(0),
        reserved: d(0),
      },
    ]);
    expect(await sellingLots(db as unknown as PrismaService, ['p'])).toEqual(
      new Set(),
    );
  });
  it('rejects fully quarantined retail stock and recalled lots', async () => {
    const db = fixture();
    db.lotSiteHolding.findMany.mockResolvedValue([
      {
        lotId: 'lot',
        organizationId: 'shop-2',
        quantity: d(3),
        reserved: d(0),
        quarantined: d(3),
      },
    ]);
    expect(await sellingLots(db as unknown as PrismaService, ['p'])).toEqual(
      new Set(),
    );
    db.lotSiteHolding.findMany.mockResolvedValue([]);
    db.traceNotice.findMany.mockResolvedValue([{ lotId: 'lot' }]);
    expect(await sellingLots(db as unknown as PrismaService, ['p'])).toEqual(
      new Set(),
    );
  });
});
