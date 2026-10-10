import type { Prisma } from '../../generated/prisma/client.js';

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

const PUBLIC_CERTIFICATE_SELECT = {
  type: true,
  issuer: true,
  issueDate: true,
  expiryDate: true,
  documentHash: true,
  status: true,
} satisfies Prisma.CertificateSelect;
const PUBLIC_CERTIFICATES = {
  where: { isPublic: true, status: 'APPROVED' },
  select: PUBLIC_CERTIFICATE_SELECT,
} satisfies Prisma.CertificateFindManyArgs;
export const PUBLIC_LOT_INCLUDE = {
  product: true,
  harvest: {
    include: {
      cycle: { include: { farm: true, certificates: PUBLIC_CERTIFICATES } },
    },
  },
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
  certificates: PUBLIC_CERTIFICATES,
} satisfies Prisma.LotInclude;
export const PUBLIC_TRACE_INCLUDE = {
  blockchainProof: {
    select: {
      eventId: true,
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
export type PublicLot = Prisma.LotGetPayload<{
  include: typeof PUBLIC_LOT_INCLUDE;
}>;
export type PublicTraceEvent = Prisma.TraceEventGetPayload<{
  include: typeof PUBLIC_TRACE_INCLUDE;
}>;
