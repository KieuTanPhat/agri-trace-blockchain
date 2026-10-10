import type { BusinessActor } from '../auth/business-write.policy.js';
import { isPastExpiry } from '../../common/expiry-date.js';
import { lotStateMatchesShipment, resolveLotCustodian } from './lot-custody.js';

export const LOT_COMMANDS = [
  'createShipment',
  'reportDamage',
  'startTransport',
  'reportArrival',
  'receiveRetail',
  'rejectRetail',
  'markForSale',
  'markSold',
  'recall',
  'expire',
] as const;
export type LotCommand = (typeof LOT_COMMANDS)[number];
export type LotActionContext = {
  currentState: string;
  farmOrgId: string;
  availableQuantity: number | string | { toString(): string };
  expiryDate?: Date | null;
  quantityReconciled?: boolean;
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
  if (
    !actor.organizationId ||
    lot.quantityReconciled === false ||
    !lotStateMatchesShipment(lot)
  )
    return [];
  const positive = Number(lot.availableQuantity) > 0;
  const commands: LotCommand[] = [];
  if (
    !lot.shipment &&
    positive &&
    lot.currentState === 'HARVESTED' &&
    actor.role === 'FARM_STAFF' &&
    actor.organizationId === lot.farmOrgId
  )
    commands.push('createShipment', 'reportDamage');
  if (
    positive &&
    lot.shipment &&
    actor.role === 'TRANSPORTER' &&
    actor.organizationId === lot.shipment.transporterOrgId
  ) {
    if (lot.shipment.status === 'CREATED' && lot.currentState === 'HARVESTED')
      commands.push('startTransport');
    if (
      lot.shipment.status === 'IN_TRANSIT' &&
      lot.currentState === 'IN_TRANSPORT'
    )
      commands.push('reportArrival', 'reportDamage');
  }
  if (
    positive &&
    lot.shipment &&
    actor.role === 'RETAILER' &&
    actor.organizationId === lot.shipment.retailerOrgId &&
    lot.shipment.status === 'ARRIVED' &&
    lot.currentState === 'ARRIVED'
  ) {
    commands.push('receiveRetail', 'rejectRetail', 'reportDamage');
  }
  const custodian = resolveLotCustodian(lot);
  if (
    custodian?.role === actor.role &&
    custodian.organizationId === actor.organizationId
  ) {
    const active = [
      'HARVESTED',
      'IN_TRANSPORT',
      'ARRIVED',
      'RETAIL_RECEIVED',
      'FOR_SALE',
    ].includes(lot.currentState);
    const expired = isPastExpiry(lot.expiryDate ?? null);
    if (
      positive &&
      actor.role === 'RETAILER' &&
      lot.shipment?.status === 'DELIVERED' &&
      !expired
    ) {
      if (lot.currentState === 'RETAIL_RECEIVED') commands.push('markForSale');
      if (lot.currentState === 'FOR_SALE') commands.push('markSold');
    }
    if ((active && positive) || lot.currentState === 'SOLD')
      commands.push('recall');
    if (active && positive && expired) commands.push('expire');
  }
  return commands;
}
