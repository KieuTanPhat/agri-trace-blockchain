import type { Prisma } from '../../generated/prisma/client.js';

export type LotCustodian = {
  role: 'FARM_STAFF' | 'TRANSPORTER' | 'RETAILER';
  organizationId: string;
};
export type CustodyContext = {
  farmOrgId: string;
  shipment: null | {
    status: string;
    transporterOrgId: string;
    retailerOrgId: string;
    pickupTime?: Date | null;
    arrivalTime?: Date | null;
    receivedTime?: Date | null;
  };
  traceEvents?: Array<{
    eventType: string;
    actorOrganizationId?: string | null;
    businessData: unknown;
  }>;
};

/** Custody follows actual handover. FAILED never implies a return to Farm. */
export function resolveLotCustodian(lot: CustodyContext): LotCustodian | null {
  const shipment = lot.shipment;
  const farm: LotCustodian = {
    role: 'FARM_STAFF',
    organizationId: lot.farmOrgId,
  };
  if (!shipment || shipment.status === 'CREATED') return farm;
  const transporter: LotCustodian = {
    role: 'TRANSPORTER',
    organizationId: shipment.transporterOrgId,
  };
  const retailer: LotCustodian = {
    role: 'RETAILER',
    organizationId: shipment.retailerOrgId,
  };
  if (shipment.status === 'IN_TRANSIT') return transporter;
  if (['ARRIVED', 'DELIVERED', 'REJECTED'].includes(shipment.status))
    return retailer;
  if (shipment.status !== 'FAILED') return null;
  const candidates: LotCustodian[] = [];
  if (shipment.arrivalTime || shipment.receivedTime) candidates.push(retailer);
  else if (shipment.pickupTime) candidates.push(transporter);
  for (const event of lot.traceEvents ?? []) {
    if (
      !['RECALL_RECORDED', 'LOT_EXPIRED', 'SHIPMENT_DAMAGE_RECORDED'].includes(
        event.eventType,
      )
    )
      continue;
    if (
      !event.businessData ||
      typeof event.businessData !== 'object' ||
      Array.isArray(event.businessData)
    )
      continue;
    const data = event.businessData as Record<string, unknown>;
    if (
      event.eventType === 'SHIPMENT_DAMAGE_RECORDED' &&
      data.fullDamage !== true
    )
      continue;
    const before = data.shipmentStateBefore;
    const indicated =
      before === 'CREATED'
        ? farm
        : before === 'IN_TRANSIT'
          ? transporter
          : before === 'ARRIVED'
            ? retailer
            : null;
    const org = data.custodianOrganizationId ?? event.actorOrganizationId;
    const candidate = [farm, transporter, retailer].find(
      (item) => item.organizationId === org,
    );
    if (
      indicated &&
      candidate &&
      indicated.organizationId !== candidate.organizationId
    )
      return null;
    if (indicated ?? candidate) candidates.push((indicated ?? candidate)!);
  }
  if (
    !candidates.length ||
    candidates.some(
      (item) => item.organizationId !== candidates[0].organizationId,
    )
  )
    return null;
  return candidates[0];
}

export const CUSTODY_EVENT_SELECT = {
  where: {
    eventType: {
      in: ['RECALL_RECORDED', 'LOT_EXPIRED', 'SHIPMENT_DAMAGE_RECORDED'],
    },
  },
  select: { eventType: true, actorOrganizationId: true, businessData: true },
} satisfies Prisma.TraceEventFindManyArgs;

export function lotStateMatchesShipment(lot: {
  currentState: string;
  shipment: { status: string } | null;
}): boolean {
  if (!lot.shipment)
    return ['HARVESTED', 'DAMAGED', 'RECALLED', 'EXPIRED'].includes(
      lot.currentState,
    );
  const states: Record<string, string[]> = {
    CREATED: ['HARVESTED'],
    IN_TRANSIT: ['IN_TRANSPORT'],
    ARRIVED: ['ARRIVED'],
    DELIVERED: ['RETAIL_RECEIVED', 'FOR_SALE', 'SOLD', 'RECALLED', 'EXPIRED'],
    REJECTED: ['REJECTED'],
    FAILED: ['DAMAGED', 'RECALLED', 'EXPIRED'],
  };
  return states[lot.shipment.status]?.includes(lot.currentState) ?? false;
}
