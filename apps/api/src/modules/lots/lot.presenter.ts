import { Prisma } from '../../generated/prisma/client.js';
import type { Actor } from '../trace/trace.service.js';
import type {
  InternalLot,
  PublicLot,
  PublicTraceEvent,
} from './lot-query.types.js';
import {
  aggregateLotProofStatus,
  getLotEventProofStatus,
} from './lot-proof-status.js';
import { getAllowedLotCommands } from './lot-action.policy.js';
import { lotEvidence } from './lot-evidence.js';
import { resolveLotCustodian } from './lot-custody.js';

type ProvenanceRun = NonNullable<InternalLot['processingRun']>;
/** Inputs consumed to make a processed lot. Private farms stay anonymous. */
export function processingProvenance(
  run: ProvenanceRun | null,
  processorName: string,
  publicView: boolean,
) {
  if (!run) return null;
  return {
    ...(publicView ? {} : { runId: run.id }),
    code: run.code,
    processType: run.processType,
    completedAt: run.completedAt,
    processorName,
    inputTotal: run.inputTotal === null ? null : Number(run.inputTotal),
    outputTotal: run.outputTotal === null ? null : Number(run.outputTotal),
    lossTotal: run.lossTotal === null ? null : Number(run.lossTotal),
    baseUnit: run.baseUnit,
    inputs: run.inputs.map((input) => ({
      ...(publicView ? {} : { lotId: input.lotId }),
      lotCode: input.lot.lotCode,
      productName: input.lot.product.productName,
      quantity: Number(input.quantity),
      unit: input.unit,
      originType: input.lot.originType,
      producerName:
        input.lot.harvest && publicView && input.lot.harvest.cycle.farm.privacy !== 'PUBLIC'
          ? 'Vùng sản xuất riêng tư'
          : input.lot.organization.name,
      harvestTime: input.lot.harvest?.harvestTime ?? null,
    })),
  };
}
const cycleSummary = (
  cycle: { id: string; cycleCode: string; currentState: string; startDate: Date | null } | undefined,
) =>
  cycle
    ? {
        cycleId: cycle.id,
        cycleCode: cycle.cycleCode,
        currentState: cycle.currentState,
        startDate: cycle.startDate,
      }
    : null;

export function toInternalLotDto(lot: InternalLot, actor: Actor) {
  const traceEvents = [
    ...lot.traceEvents,
    ...(lot.harvest?.cycle.traceEvents ?? []),
  ].sort(
    (a, b) =>
      a.eventTime.getTime() - b.eventTime.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const evidence = lotEvidence(lot, traceEvents);
  const latest = traceEvents.at(-1);
  return {
    lotId: lot.id,
    chainId: lot.harvest?.cycle.chainId ?? lot.processingRun?.chainId ?? null,
    originType: lot.originType,
    processing: processingProvenance(lot.processingRun, lot.organization.name, false),
    traceToken: lot.traceQr?.traceToken,
    lotCode: lot.lotCode,
    lotName: lot.lotName,
    packageCount: lot.packageCount,
    packaging: lot.packaging,
    packedAt: lot.packedAt?.toISOString().slice(0, 10) ?? null,
    initialStorageSiteId: lot.initialStorageSiteId,
    productName: lot.product.productName,
    harvestTime: lot.harvest?.harvestTime ?? lot.processingRun?.completedAt ?? lot.createdAt,
    initialQuantity: Number(lot.initialQuantity),
    availableQuantity: Number(lot.availableQuantity),
    unit: lot.unit,
    currentState: lot.currentState,
    version: lot.version,
    ...evidence,
    custodian: resolveLotCustodian(lot),
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
    productionCycle: cycleSummary(lot.harvest?.cycle),
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
    allowedCommands: getAllowedLotCommands(
      { ...lot, quantityReconciled: evidence.quantityReconciled },
      actor,
    ),
    proofStatus:
      evidence.sensorEvidence.status === 'INTEGRITY_WARNING'
        ? 'INTEGRITY_WARNING'
        : aggregateLotProofStatus(traceEvents),
    timeline: traceEvents.map((event) => ({
      eventId: event.id,
      entityType: event.entityType,
      eventType: event.eventType,
      eventTime: event.eventTime,
      summary: eventSummary(event.eventType),
      proofStatus: getLotEventProofStatus(event),
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
          handoverMode: lot.shipment.handoverMode,
        }
      : undefined,
  };
}

export function toPublicLotDto(
  lot: PublicLot,
  traceToken: string,
  traceEvents: PublicTraceEvent[],
) {
  const evidence = lotEvidence(lot, traceEvents);
  const latest = traceEvents.at(-1);
  return {
    lotId: lot.id,
    traceToken,
    lotCode: lot.lotCode,
    lotName: lot.lotName,
    productName: lot.product.productName,
    harvestTime: lot.harvest?.harvestTime ?? lot.processingRun?.completedAt ?? lot.createdAt,
    initialQuantity: Number(lot.initialQuantity),
    availableQuantity: Number(lot.availableQuantity),
    unit: lot.unit,
    currentState: lot.currentState,
    ...evidence,
    originType: lot.originType,
    processing: processingProvenance(lot.processingRun, lot.organization?.name ?? '', true),
    productionCycle: cycleSummary(lot.harvest?.cycle),
    farmOrg: lot.harvest
      ? {
          organizationId: lot.harvest.cycle.farm.organizationId,
          name: lot.harvest.cycle.farm.privacy === 'PUBLIC' ? lot.harvest.cycle.farm.name : 'Vùng sản xuất riêng tư',
          type: 'FARM',
        }
      : {
          organizationId: lot.organization.id,
          name: lot.organization.name,
          type: lot.organization.type,
        },
    allowedCommands: [],
    proofStatus:
      evidence.sensorEvidence.status === 'INTEGRITY_WARNING'
        ? 'INTEGRITY_WARNING'
        : aggregateLotProofStatus(traceEvents),
    timeline: traceEvents.map((event) => ({
      eventId: event.id,
      entityType: event.entityType,
      eventType: event.eventType,
      eventTime: event.eventTime,
      summary: eventSummary(event.eventType),
      proofStatus: getLotEventProofStatus(event),
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
    certificates: [...lot.certificates, ...(lot.harvest?.cycle.certificates ?? [])].map(
      publicCertificate,
    ),
  };
}

function publicCertificate(certificate: PublicLot['certificates'][number]) {
  return {
    type: certificate.type,
    issuer: certificate.issuer,
    issueDate: certificate.issueDate,
    expiryDate: certificate.expiryDate,
    documentHash: certificate.documentHash,
    status: certificate.status,
  };
}

export function eventSummary(eventType: string) {
  const summaries: Record<string, string> = {
    EVIDENCE_ATTACHED: 'Bổ sung hình ảnh và hồ sơ cho giai đoạn này.',
    EVIDENCE_WITHDRAWN: 'Gỡ tài liệu đã công khai.',
    DISTRIBUTION_SITE_ALLOCATED: 'Sắp xếp hàng vào địa điểm bảo quản.',
    PROCESSING_RUN_CREATED: 'Chuẩn bị chế biến.',
    PROCESSING_RUN_COMPLETED: 'Hoàn thành chế biến và tạo lô thành phẩm.',
    PROCESSING_COMPLETED: 'Hoàn thành chế biến và đóng gói.',
    SITE_TRANSFER_COMPLETED: 'Chuyển hàng sang địa điểm mới.',
    DISTRIBUTION_PROPOSED: 'Chuẩn bị giao hàng.',
    DISTRIBUTION_ATTESTED: 'Xác nhận thông tin giao nhận.',
    DISTRIBUTION_READY: 'Hàng đã sẵn sàng bàn giao.',
    DISTRIBUTION_IN_TRANSIT: 'Đã bàn giao cho đơn vị vận chuyển.',
    DISTRIBUTION_DELIVERED: 'Điểm nhận đã nhận hàng.',
    DISTRIBUTION_CANCELLED: 'Hủy giao nhận trước khi bàn giao hàng.',
    DISTRIBUTION_QUANTITY_RECORDED:
      'Ghi nhận thay đổi số lượng của lô (bán, hao hụt hoặc chế biến).',
    PRODUCTION_CYCLE_CREATED: 'Mở mùa vụ trồng mới.',
    CYCLE_PLANTED: 'Ghi nhận gieo trồng.',
    CARE_RECORDED: 'Ghi nhận hoạt động chăm sóc.',
    SENSOR_READING_RECORDED: 'Ghi nhận dữ liệu cảm biến.',
    HARVEST_RECORDED: 'Ghi nhận thu hoạch và tạo lô.',
    SHIPMENT_CREATED: 'Tạo chuyến vận chuyển.',
    SHIPMENT_STARTED: 'Bắt đầu vận chuyển.',
    SHIPMENT_ARRIVED: 'Lô hàng đã đến nơi nhận.',
    SHIPMENT_RECEIVED: 'Nhà bán lẻ đã nhận lô hàng.',
    SHIPMENT_REJECTED: 'Nhà bán lẻ từ chối lô hàng.',
    SHIPMENT_DAMAGE_RECORDED: 'Ghi nhận hàng hư hỏng.',
    SENSOR_DIGEST_CREATED: 'Chốt bản tổng hợp dữ liệu cảm biến.',
    SHIPMENT_TELEMETRY_DIGEST_CREATED: 'Chốt bản tổng hợp dữ liệu vận chuyển.',
    INSPECTION_RECORDED: 'Ghi nhận kết quả thanh tra.',
    CERTIFICATE_SUBMITTED: 'Gửi chứng chỉ để xét duyệt.',
    CERTIFICATE_APPROVED: 'Chứng chỉ đã được phê duyệt.',
    CERTIFICATE_REJECTED: 'Chứng chỉ bị từ chối.',
    SENSOR_DIGEST_FINALIZED: 'Chốt dữ liệu cảm biến cho lần thu hoạch.',
    PARTIAL_DAMAGE_RECORDED: 'Ghi nhận một phần hàng hư hỏng tại Farm.',
    DAMAGE_RECORDED: 'Toàn bộ lượng hàng còn lại đã hư hỏng tại Farm.',
    MARKED_FOR_SALE: 'Nhà bán lẻ đưa lô hàng ra bán.',
    LOT_SOLD: 'Đã bán toàn bộ lượng hàng còn lại.',
    RECALL_RECORDED: 'Lô hàng đã được thu hồi.',
    LOT_EXPIRED: 'Ghi nhận lô hàng hết hạn sử dụng.',
  };
  return summaries[eventType] ?? 'Cập nhật nhật ký của lô hàng.';
}
