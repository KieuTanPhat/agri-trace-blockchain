import { allowedCommands, type LotActionContext } from './lot-action.policy.js';
import { lotReadScope } from './lot-read.scope.js';

const shipment = {
  status: 'CREATED',
  transporterOrgId: 'transport',
  retailerOrgId: 'retail',
};
const actor = (role: string, organizationId: string | null) => ({
  sub: 'user',
  role,
  organizationId,
});

describe('Pure lot action policy', () => {
  it.each([
    ['FARM_STAFF', 'farm', 'HARVESTED', null, ['createShipment']],
    ['FARM_STAFF', 'foreign', 'HARVESTED', null, []],
    ['SYSTEM_ADMIN', null, 'HARVESTED', null, ['createShipment']],
    ['TRANSPORTER', 'transport', 'HARVESTED', shipment, ['startTransport']],
    ['TRANSPORTER', 'foreign', 'HARVESTED', shipment, []],
    [
      'TRANSPORTER',
      'transport',
      'IN_TRANSIT',
      { ...shipment, status: 'IN_TRANSIT' },
      ['reportArrival', 'reportDamage'],
    ],
    [
      'RETAILER',
      'retail',
      'ARRIVED',
      { ...shipment, status: 'ARRIVED' },
      ['receiveRetail', 'rejectRetail', 'reportDamage'],
    ],
    ['AUDITOR', 'farm', 'HARVESTED', null, []],
    ['SYSTEM_ADMIN', null, 'DAMAGED', { ...shipment, status: 'FAILED' }, []],
  ] as const)(
    'preserves %s command visibility for %s',
    (role, org, state, delivery, expected) => {
      const lot: LotActionContext = Object.freeze({
        currentState: state,
        farmOrgId: 'farm',
        shipment: delivery,
      });
      expect(allowedCommands(lot, Object.freeze(actor(role, org)))).toEqual(
        expected,
      );
    },
  );

  it('keeps unscoped business accounts outside other organizations', () => {
    expect(lotReadScope(actor('FARM_STAFF', null))).toEqual({
      OR: [
        { farmOrgId: '00000000-0000-0000-0000-000000000000' },
        {
          shipment: {
            transporterOrgId: '00000000-0000-0000-0000-000000000000',
          },
        },
        { shipment: { retailerOrgId: '00000000-0000-0000-0000-000000000000' } },
      ],
    });
    expect(lotReadScope(actor('AUDITOR', null))).toBeUndefined();
    expect(lotReadScope(actor('SYSTEM_ADMIN', null))).toBeUndefined();
  });
});
