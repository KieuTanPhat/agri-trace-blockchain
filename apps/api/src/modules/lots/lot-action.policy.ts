import type { BusinessActor } from '../auth/business-write.policy.js';

export type LotCommand =
  | 'createShipment'
  | 'startTransport'
  | 'reportArrival'
  | 'receiveRetail'
  | 'rejectRetail'
  | 'reportDamage';
export type LotActionContext = {
  currentState: string;
  farmOrgId: string;
  availableQuantity: number | string | { toString(): string };
  shipment: null | {
    status: string;
    transporterOrgId: string;
    retailerOrgId: string;
  };
};

export function getAllowedLotCommands(
  lot: LotActionContext,
  actor: BusinessActor,
): LotCommand[] {
  if (!actor.organizationId || !(Number(lot.availableQuantity) > 0)) return [];
  if (!lot.shipment) {
    return lot.currentState === 'HARVESTED' &&
      actor.role === 'FARM_STAFF' &&
      actor.organizationId === lot.farmOrgId
      ? ['createShipment']
      : [];
  }
  if (
    actor.role === 'TRANSPORTER' &&
    actor.organizationId === lot.shipment.transporterOrgId
  ) {
    if (lot.shipment.status === 'CREATED' && lot.currentState === 'HARVESTED')
      return ['startTransport'];
    if (
      lot.shipment.status === 'IN_TRANSIT' &&
      lot.currentState === 'IN_TRANSPORT'
    )
      return ['reportArrival', 'reportDamage'];
  }
  if (
    actor.role === 'RETAILER' &&
    actor.organizationId === lot.shipment.retailerOrgId &&
    lot.shipment.status === 'ARRIVED' &&
    lot.currentState === 'ARRIVED'
  ) {
    return ['receiveRetail', 'rejectRetail', 'reportDamage'];
  }
  return [];
}
