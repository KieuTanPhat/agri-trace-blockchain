import { Prisma } from '../../generated/prisma/client.js';
export const LOT_TRACE_INCLUDE = {
  blockchainProof: true,
  blockchainOutbox: { select: { status: true } },
  actor: { select: { id: true } },
  organization: { select: { id: true, name: true } },
} satisfies Prisma.TraceEventInclude;
export const INTERNAL_LOT_INCLUDE = {
  product: true,
  organization: true,
  harvest: {
    include: {
      cycle: {
        include: {
          farm: true,
          plot: true,
          traceEvents: {
            where: { lotId: null },
            include: LOT_TRACE_INCLUDE,
          },
        },
      },
    },
  },
  shipment: { include: { transporter: true, retailer: true } },
  quantityMovements: { orderBy: { createdAt: 'asc' as const } },
  traceEvents: {
    include: LOT_TRACE_INCLUDE,
  },
  certificates: true,
  inspections: true,
  traceQr: true,
} satisfies Prisma.LotInclude;
export type InternalLot = Prisma.LotGetPayload<{
  include: typeof INTERNAL_LOT_INCLUDE;
}>;
export const PUBLIC_TRACE_INCLUDE = {
  lot: {
    include: {
      product: true,
      harvest: { include: { cycle: { include: { farm: true } } } },
      shipment: {
        select: {
          status: true,
          origin: true,
          destination: true,
          pickupTime: true,
          arrivalTime: true,
          receivedTime: true,
        },
      },
      certificates: {
        where: { isPublic: true, status: 'APPROVED' },
        select: {
          type: true,
          issuer: true,
          issueDate: true,
          expiryDate: true,
          documentHash: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.TraceQrInclude;
export const PUBLIC_EVENT_INCLUDE = {
  blockchainProof: {
    select: {
      transactionStatus: true,
      txId: true,
      channelId: true,
      recordedAt: true,
      dataHash: true,
      network: true,
    },
  },
  blockchainOutbox: { select: { status: true } },
} satisfies Prisma.TraceEventInclude;
export type PublicLot = Prisma.TraceQrGetPayload<{
  include: typeof PUBLIC_TRACE_INCLUDE;
}>['lot'];
export type PublicProofEvent = Prisma.TraceEventGetPayload<{
  include: typeof PUBLIC_EVENT_INCLUDE;
}>;

// Hash verification still needs the full canonical input; dashboard counts do
// not need actors, organizations, movement ledgers, certificates or QR details.
export const DASHBOARD_PROOF_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  cycleId: true,
  lotId: true,
  eventType: true,
  eventTime: true,
  actorUserId: true,
  actorOrganizationId: true,
  actorRole: true,
  authProofType: true,
  actorAuthProof: true,
  businessData: true,
  previousEventHash: true,
  schemaVersion: true,
  canonicalizationVersion: true,
  dataHash: true,
  blockchainProof: { select: { dataHash: true, transactionStatus: true } },
  blockchainOutbox: { select: { status: true } },
} satisfies Prisma.TraceEventSelect;

export const DASHBOARD_LOT_SELECT = {
  id: true,
  shipment: { select: { status: true } },
  traceEvents: { select: DASHBOARD_PROOF_SELECT },
  harvest: {
    select: {
      cycle: {
        select: {
          traceEvents: {
            where: { lotId: null },
            select: DASHBOARD_PROOF_SELECT,
          },
        },
      },
    },
  },
} satisfies Prisma.LotSelect;
