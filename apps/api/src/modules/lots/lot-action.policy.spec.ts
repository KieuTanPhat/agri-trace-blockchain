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
