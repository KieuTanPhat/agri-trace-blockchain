import type { Actor } from '../trace/trace.service.js';
export type AllowedLotCommand =
  | 'createShipment'
  | 'startTransport'
  | 'reportArrival'
  | 'reportDamage'
  | 'receiveRetail'
  | 'rejectRetail';
export interface LotActionContext {
  currentState: string;
  farmOrgId: string;
  shipment: null | {
    status: string;
    transporterOrgId: string;
    retailerOrgId: string;
  };
}
export function allowedCommands(
  lot: LotActionContext,
  actor: Actor,
): AllowedLotCommand[] {
  const admin = actor.role === 'SYSTEM_ADMIN';
  if (!lot.shipment) {
    return lot.currentState === 'HARVESTED' &&
      (admin ||
        (actor.role === 'FARM_STAFF' && actor.organizationId === lot.farmOrgId))
      ? ['createShipment']
      : [];
  }
  if (
    lot.shipment.status === 'CREATED' &&
    (admin ||
      (actor.role === 'TRANSPORTER' &&
        actor.organizationId === lot.shipment.transporterOrgId))
  )
    return ['startTransport'];
  if (
    lot.shipment.status === 'IN_TRANSIT' &&
    (admin ||
      (actor.role === 'TRANSPORTER' &&
        actor.organizationId === lot.shipment.transporterOrgId))
  )
    return ['reportArrival', 'reportDamage'];
  if (
    lot.shipment.status === 'ARRIVED' &&
    (admin ||
      (actor.role === 'RETAILER' &&
        actor.organizationId === lot.shipment.retailerOrgId))
  )
    return ['receiveRetail', 'rejectRetail', 'reportDamage'];
  return [];
}
