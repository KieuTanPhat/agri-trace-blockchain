import { Prisma } from '../../generated/prisma/client.js';
import type { Actor } from '../trace/trace.service.js';
import type {
  InternalLot,
  PublicLot,
  PublicProofEvent,
} from './lot-query.types.js';
import { allowedCommands } from './lot-action.policy.js';
import { eventSummary } from './lot-event-summary.js';
import { aggregateProofStatus, proofStatus } from './lot-proof-status.js';
export function presentInternalLot(lot: InternalLot, actor: Actor) {
  const traceEvents = [
    ...lot.traceEvents,
    ...lot.harvest.cycle.traceEvents,
  ].sort(
    (a, b) =>
      a.eventTime.getTime() - b.eventTime.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const latest = traceEvents.at(-1);
  return {
    lotId: lot.id,
    traceToken: lot.traceQr?.traceToken,
    lotCode: lot.lotCode,
    productName: lot.product.productName,
    harvestTime: lot.harvest.harvestTime,
    initialQuantity: Number(lot.initialQuantity),
    availableQuantity: Number(lot.availableQuantity),
    unit: lot.unit,
    currentState: lot.currentState,
    version: lot.version,
    quantityMovements: lot.quantityMovements.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: Number(m.quantity),
      beforeQty: Number(m.beforeQty),
      delta: Number(m.delta),
      afterQty: Number(m.afterQty),
      unit: m.unit,
      createdAt: m.createdAt,
    })),
    damagedQuantity: lot.quantityMovements
      .filter((m) => m.type === 'DAMAGE_OUT')
      .reduce((sum, m) => sum.add(m.quantity), new Prisma.Decimal(0))
      .toNumber(),
    productionCycle: {
      cycleId: lot.harvest.cycle.id,
      cycleCode: lot.harvest.cycle.cycleCode,
      currentState: lot.harvest.cycle.currentState,
      startDate: lot.harvest.cycle.startDate,
    },
    farmOrg: {
      organizationId: lot.organization.id,
      name: lot.organization.name,
      type: lot.organization.type,
    },
    retailerOrg: lot.shipment
      ? {
          organizationId: lot.shipment.retailer.id,
          name: lot.shipment.retailer.name,
          type: lot.shipment.retailer.type,
        }
      : undefined,
    allowedCommands: allowedCommands(lot, actor),
    proofStatus: aggregateProofStatus(traceEvents),
    timeline: traceEvents.map((event) => ({
      eventId: event.id,
      entityType: event.entityType,
      eventType: event.eventType,
      eventTime: event.eventTime,
      summary: eventSummary(event.eventType),
      proofStatus: proofStatus(event),
      actor: {
        userId: event.actor?.id,
        role: event.actorRole,
        organizationId: event.organization?.id,
        organizationName: event.organization?.name ?? 'Hệ thống',
      },
    })),
    blockchainProof: latest?.blockchainProof
      ? {
          network: latest.blockchainProof.network,
          txId: latest.blockchainProof.txId,
          dataHash: latest.dataHash,
          transactionStatus: latest.blockchainProof.transactionStatus,
          recordedAt: latest.blockchainProof.recordedAt,
        }
      : undefined,
    shipment: lot.shipment
      ? {
          shipmentId: lot.shipment.id,
          status: lot.shipment.status,
          version: lot.shipment.version,
          transporterOrgId: lot.shipment.transporterOrgId,
          retailerOrgId: lot.shipment.retailerOrgId,
          origin: lot.shipment.origin,
          destination: lot.shipment.destination,
          shippedQuantity: Number(lot.shipment.shippedQuantity),
          receivedQuantity:
            lot.shipment.receivedQuantity === null
              ? null
              : Number(lot.shipment.receivedQuantity),
          rejectedQuantity:
            lot.shipment.rejectedQuantity === null
              ? null
              : Number(lot.shipment.rejectedQuantity),
        }
      : undefined,
  };
}
export function presentPublicLot(
  lot: PublicLot,
  traceToken: string,
  traceEvents: PublicProofEvent[],
) {
  const latest = traceEvents.at(-1);
  return {
    lotId: lot.id,
    traceToken,
    lotCode: lot.lotCode,
    productName: lot.product.productName,
    harvestTime: lot.harvest.harvestTime,
    initialQuantity: Number(lot.initialQuantity),
    availableQuantity: Number(lot.availableQuantity),
    unit: lot.unit,
    currentState: lot.currentState,
    productionCycle: {
      cycleId: lot.harvest.cycle.id,
      cycleCode: lot.harvest.cycle.cycleCode,
      currentState: lot.harvest.cycle.currentState,
      startDate: lot.harvest.cycle.startDate,
    },
    farmOrg: {
      organizationId: lot.harvest.cycle.farm.organizationId,
      name: lot.harvest.cycle.farm.name,
      type: 'FARM',
    },
    allowedCommands: [],
    proofStatus: aggregateProofStatus(traceEvents),
    timeline: traceEvents.map((event) => ({
      eventId: event.id,
      entityType: event.entityType,
      eventType: event.eventType,
      eventTime: event.eventTime,
      summary: eventSummary(event.eventType),
      proofStatus: proofStatus(event),
      actor: { role: 'SYSTEM_ACTOR', organizationName: 'AgriTrace' },
    })),
    blockchainProof: latest?.blockchainProof
      ? {
          network: latest.blockchainProof.network,
          txId: latest.blockchainProof.txId,
          dataHash: latest.dataHash,
          transactionStatus: latest.blockchainProof.transactionStatus,
          recordedAt: latest.blockchainProof.recordedAt,
        }
      : undefined,
    shipment: lot.shipment,
    certificates: lot.certificates,
  };
}
export type InternalLotDto = ReturnType<typeof presentInternalLot>;
export type PublicLotDto = ReturnType<typeof presentPublicLot>;
