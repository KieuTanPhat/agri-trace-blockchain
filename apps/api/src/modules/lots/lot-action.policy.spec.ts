import {
  getAllowedLotCommands,
  type LotActionContext,
} from './lot-action.policy.js';

const lot: LotActionContext = {
  farmOrgId: 'farm',
  currentState: 'HARVESTED',
  availableQuantity: '1.000',
  shipment: null,
};
const shipment = {
  status: 'CREATED',
  transporterOrgId: 'carrier',
  retailerOrgId: 'retailer',
};

describe('Lot action policy', () => {
  describe('minimal retail sale', () => {
    const retailer = { role: 'RETAILER', organizationId: 'retailer' };
    const received: LotActionContext = {
      ...lot,
      currentState: 'RETAIL_RECEIVED',
      shipment: { ...shipment, status: 'DELIVERED' },
    };
    const saleCommands = (context: LotActionContext, actor = retailer) =>
      getAllowedLotCommands(context, actor).filter((command) =>
        ['markForSale', 'markSold'].includes(command),
      );

    it.each(['STANDARD', 'DUAL_SIGNED'])(
      'offers only the next sale transition after %s delivery',
      (handoverMode) => {
        const context = {
          ...received,
          shipment: { ...shipment, status: 'DELIVERED', handoverMode },
        };
        expect(saleCommands(context)).toEqual(['markForSale']);
        expect(saleCommands({ ...context, currentState: 'FOR_SALE' })).toEqual([
          'markSold',
        ]);
      },
    );

    it.each(['RETAIL_RECEIVED', 'FOR_SALE'])(
      'denies wrong actors, empty stock, expired or unreconciled %s lots',
      (currentState) => {
        const context = { ...received, currentState };
        for (const role of [
          'FARM_STAFF',
          'TRANSPORTER',
          'SYSTEM_ADMIN',
          'AUDITOR',
        ])
          expect(saleCommands(context, { ...retailer, role })).toEqual([]);
        expect(
          saleCommands(context, { ...retailer, organizationId: 'other' }),
        ).toEqual([]);
        for (const override of [
          { availableQuantity: '0' },
          { quantityReconciled: false },
          { expiryDate: new Date('2000-01-01T00:00:00Z') },
          { shipment: null },
          { shipment: { ...shipment, status: 'ARRIVED' } },
        ])
          expect(saleCommands({ ...context, ...override })).toEqual([]);
      },
    );

    it.each(['SOLD', 'RECALLED', 'EXPIRED', 'DAMAGED', 'REJECTED', 'ARRIVED'])(
      'never offers sale commands in %s even if stock is positive',
      (currentState) => {
        expect(saleCommands({ ...received, currentState })).toEqual([]);
      },
    );

    it('retains recall after sold without offering another sale', () => {
      expect(
        getAllowedLotCommands(
          { ...received, currentState: 'SOLD', availableQuantity: '0' },
          retailer,
        ),
      ).toEqual(['recall']);
    });
  });

  it.each(['SYSTEM_ADMIN', 'AUDITOR'])(
    'never offers business commands to %s even in the owning organization',
    (role) => {
      for (const fixture of [
        lot,
        { ...lot, shipment },
        {
          ...lot,
          currentState: 'IN_TRANSPORT',
          shipment: { ...shipment, status: 'IN_TRANSIT' },
        },
        {
          ...lot,
          currentState: 'ARRIVED',
          shipment: { ...shipment, status: 'ARRIVED' },
        },
      ]) {
        for (const organizationId of ['farm', 'carrier', 'retailer'])
          expect(
            getAllowedLotCommands(fixture, { role, organizationId }),
          ).toEqual([]);
      }
    },
  );
  it('never offers the direct start/arrive commands on a DUAL_SIGNED shipment', () => {
    const signed = { ...shipment, handoverMode: 'DUAL_SIGNED' };
    expect(
      getAllowedLotCommands(
        { ...lot, shipment: signed },
        { role: 'TRANSPORTER', organizationId: 'carrier' },
      ),
    ).toEqual([]);
    expect(
      getAllowedLotCommands(
        {
          ...lot,
          currentState: 'IN_TRANSPORT',
          shipment: { ...signed, status: 'IN_TRANSIT' },
        },
        { role: 'TRANSPORTER', organizationId: 'carrier' },
      ),
    ).toEqual(['reportDamage', 'recall']);
  });
  it('offers commands only to the matching role, state and organization', () => {
    expect(
      getAllowedLotCommands(lot, {
        role: 'FARM_STAFF',
        organizationId: 'farm',
      }),
    ).toEqual(['createShipment', 'reportDamage', 'recall']);
    expect(
      getAllowedLotCommands(
        { ...lot, shipment },
        { role: 'TRANSPORTER', organizationId: 'carrier' },
      ),
    ).toEqual(['startTransport']);
    expect(
      getAllowedLotCommands(
        {
          ...lot,
          currentState: 'IN_TRANSPORT',
          shipment: { ...shipment, status: 'IN_TRANSIT' },
        },
        { role: 'TRANSPORTER', organizationId: 'carrier' },
      ),
    ).toEqual(['reportArrival', 'reportDamage', 'recall']);
    expect(
      getAllowedLotCommands(
        {
          ...lot,
          currentState: 'ARRIVED',
          shipment: { ...shipment, status: 'ARRIVED' },
        },
        { role: 'RETAILER', organizationId: 'retailer' },
      ),
    ).toEqual(['receiveRetail', 'rejectRetail', 'reportDamage', 'recall']);
  });
  it('denies missing/wrong organizations, wrong roles, empty stock and inconsistent states', () => {
    expect(
      getAllowedLotCommands(lot, { role: 'FARM_STAFF', organizationId: null }),
    ).toEqual([]);
    expect(
      getAllowedLotCommands(lot, {
        role: 'FARM_STAFF',
        organizationId: 'other',
      }),
    ).toEqual([]);
    expect(
      getAllowedLotCommands(
        { ...lot, availableQuantity: '0' },
        { role: 'FARM_STAFF', organizationId: 'farm' },
      ),
    ).toEqual([]);
    expect(
      getAllowedLotCommands(
        { ...lot, shipment },
        { role: 'RETAILER', organizationId: 'carrier' },
      ),
    ).toEqual([]);
    expect(
      getAllowedLotCommands(
        { ...lot, currentState: 'DAMAGED', shipment },
        { role: 'TRANSPORTER', organizationId: 'carrier' },
      ),
    ).toEqual([]);
  });
});
