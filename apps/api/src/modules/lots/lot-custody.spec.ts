import { resolveLotCustodian, type CustodyContext } from './lot-custody.js';

const organizationId = 'same-enterprise';
const failed: CustodyContext = {
  farmOrgId: organizationId,
  shipment: {
    status: 'FAILED',
    transporterOrgId: organizationId,
    retailerOrgId: organizationId,
  },
};
const event = (businessData: Record<string, unknown>) => ({
  eventType: 'SHIPMENT_DAMAGE_RECORDED',
  actorOrganizationId: organizationId,
  businessData: { fullDamage: true, ...businessData },
});

describe('Custody stage for an enterprise performing multiple stages', () => {
  it.each([
    ['CREATED', 'FARM_STAFF'],
    ['IN_TRANSIT', 'TRANSPORTER'],
    ['ARRIVED', 'RETAILER'],
    ['DELIVERED', 'RETAILER'],
    ['REJECTED', 'RETAILER'],
  ])('resolves %s by stage', (status, role) => {
    expect(
      resolveLotCustodian({
        ...failed,
        shipment: { ...failed.shipment!, status },
      }),
    ).toEqual({ organizationId, role });
  });

  it.each([
    ['CREATED', 'FARM_STAFF'],
    ['IN_TRANSIT', 'TRANSPORTER'],
    ['ARRIVED', 'RETAILER'],
  ])('retains the %s stage after full damage', (before, role) => {
    expect(
      resolveLotCustodian({
        ...failed,
        traceEvents: [event({ shipmentStateBefore: before })],
      }),
    ).toEqual({ organizationId, role });
  });

  it('fails closed when an organization identifier cannot distinguish the stage', () => {
    expect(
      resolveLotCustodian({ ...failed, traceEvents: [event({})] }),
    ).toBeNull();
  });

  it('does not ignore conflicting stages within the same enterprise', () => {
    expect(
      resolveLotCustodian({
        ...failed,
        shipment: { ...failed.shipment!, arrivalTime: new Date() },
        traceEvents: [event({ shipmentStateBefore: 'IN_TRANSIT' })],
      }),
    ).toBeNull();
  });

  it('uses arrival evidence when later legacy events only name the same enterprise', () => {
    expect(
      resolveLotCustodian({
        ...failed,
        shipment: { ...failed.shipment!, arrivalTime: new Date() },
        traceEvents: [event({})],
      }),
    ).toEqual({ organizationId, role: 'RETAILER' });
  });

  it('does not assign custody from an event for a non-party organization', () => {
    expect(
      resolveLotCustodian({
        ...failed,
        shipment: { ...failed.shipment!, pickupTime: new Date() },
        traceEvents: [event({ custodianOrganizationId: 'outsider' })],
      }),
    ).toBeNull();
  });

  it('rejects an explicit custodian outside the stage organization', () => {
    expect(
      resolveLotCustodian({
        ...failed,
        traceEvents: [
          event({
            shipmentStateBefore: 'ARRIVED',
            custodianOrganizationId: 'outsider',
          }),
        ],
      }),
    ).toBeNull();
  });

  it('does not infer a stage from organization-only evidence', () => {
    expect(
      resolveLotCustodian({
        farmOrgId: 'farm',
        shipment: {
          status: 'FAILED',
          transporterOrgId: 'carrier',
          retailerOrgId: 'shop',
        },
        traceEvents: [{ ...event({}), actorOrganizationId: 'carrier' }],
      }),
    ).toBeNull();
  });
});
