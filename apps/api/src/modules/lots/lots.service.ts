import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import type { RecordHarvestDto } from './dto.js';

const INTERNAL_LOT_INCLUDE = {
  product: true,
  organization: true,
  harvest: { include: { cycle: { include: { farm: true, plot: true } } } },
  shipment: { include: { transporter: true, retailer: true } },
  quantityMovements: { orderBy: { createdAt: 'asc' as const } },
  traceEvents: {
    orderBy: { eventTime: 'asc' as const },
    include: {
      blockchainProof: true,
      actor: { select: { id: true } },
      organization: { select: { id: true, name: true } },
    },
  },
  certificates: true,
  inspections: true,
  traceQr: true,
} satisfies Prisma.LotInclude;

type InternalLot = Prisma.LotGetPayload<{
  include: typeof INTERNAL_LOT_INCLUDE;
}>;

@Injectable()
export class LotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly trace: TraceService,
  ) {}

  async recordHarvest(cycleId: string, input: RecordHarvestDto, actor: Actor) {
    await this.access.assertProductionCycleAccess(actor, cycleId);
    return this.prisma.$transaction(
      async (tx) => {
        const cycle = await tx.productionCycle.findUnique({
          where: { id: cycleId },
        });
        if (!cycle)
          throw new NotFoundException('Không tìm thấy chu kỳ sản xuất');
        if (!['PLANTED', 'GROWING'].includes(cycle.currentState))
          throw new ConflictException(
            'Chu kỳ không ở trạng thái có thể thu hoạch',
          );
        if (cycle.harvestUnit && cycle.harvestUnit !== input.unit)
          throw new UnprocessableEntityException(
            'Đơn vị thu hoạch không khớp kế hoạch',
          );
        if (input.finalSensorDigestId) {
          const digest = await tx.sensorDigest.findUnique({
            where: { id: input.finalSensorDigestId },
          });
          if (!digest || digest.cycleId !== cycleId || !digest.isFinal)
            throw new UnprocessableEntityException(
              'Sensor digest cuối kỳ không thuộc chu kỳ hoặc chưa được finalize',
            );
        }
        const aggregate = await tx.harvestEvent.aggregate({
          where: { cycleId },
          _sum: { quantity: true },
        });
        const harvested = aggregate._sum.quantity ?? new Prisma.Decimal(0);
        const total = harvested.add(input.quantity);
        if (
          cycle.maxHarvestQuantity &&
          total.greaterThan(cycle.maxHarvestQuantity)
        ) {
          throw new UnprocessableEntityException(
            'Tổng sản lượng thu hoạch vượt giới hạn của chu kỳ',
          );
        }
        const harvest = await tx.harvestEvent.create({
          data: {
            cycleId,
            finalSensorDigestId: input.finalSensorDigestId,
            harvestTime: new Date(input.harvestTime),
            quantity: input.quantity,
            unit: input.unit,
            grade: input.grade,
            qualityNote: input.qualityNote,
            harvestArea: input.harvestArea,
          },
        });
        const lotCode =
          input.lotCode?.trim() ||
          `LOT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${harvest.id.slice(0, 8).toUpperCase()}`;
        const lot = await tx.lot.create({
          data: {
            lotCode,
            harvestId: harvest.id,
            productId: cycle.productId,
            farmOrgId: cycle.farmOrgId,
            initialQuantity: input.quantity,
            availableQuantity: input.quantity,
            unit: input.unit,
            grade: input.grade,
            expiryDate: input.expiryDate
              ? new Date(input.expiryDate)
              : undefined,
          },
        });
        const event = await this.trace.createInTransaction(tx, {
          entityType: 'HARVEST',
          entityId: harvest.id,
          cycleId,
          lotId: lot.id,
          eventType: 'HARVEST_RECORDED',
          actor,
          eventTime: harvest.harvestTime,
          businessData: {
            lotCode,
            quantity: String(input.quantity),
            unit: input.unit,
            grade: input.grade ?? null,
          },
        });
        await tx.quantityMovement.create({
          data: {
            lotId: lot.id,
            eventId: event.id,
            type: 'HARVEST_IN',
            quantity: input.quantity,
            unit: input.unit,
            beforeQty: 0,
            delta: input.quantity,
            afterQty: input.quantity,
          },
        });
        const traceToken = randomBytes(24).toString('base64url');
        const traceQr = await tx.traceQr.create({
          data: {
            lotId: lot.id,
            traceToken,
            traceUrl: `${process.env.PUBLIC_TRACE_BASE_URL ?? 'http://localhost:3000/trace'}/${traceToken}`,
          },
        });
        return { harvest, lot, traceQr };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getInternal(lotId: string, actor: Actor) {
    await this.access.assertLotAccess(actor, lotId);
    const lot = await this.prisma.lot.findUnique({
      where: { id: lotId },
      include: INTERNAL_LOT_INCLUDE,
    });
    if (!lot) throw new NotFoundException('Không tìm thấy lô hàng');
    const traceEvents = await this.prisma.traceEvent.findMany({
      where: {
        OR: [{ lotId }, { cycleId: lot.harvest.cycle.id }],
      },
      orderBy: [{ eventTime: 'asc' }, { createdAt: 'asc' }],
      include: {
        blockchainProof: true,
        actor: { select: { id: true } },
        organization: { select: { id: true, name: true } },
      },
    });
    return this.toInternalDto({ ...lot, traceEvents }, actor);
  }

  async getList(actor: Actor) {
    const lots = await this.prisma.lot.findMany({
      where: ['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)
        ? undefined
        : {
            OR: [
              { farmOrgId: actor.organizationId ?? undefined },
              {
                shipment: {
                  transporterOrgId: actor.organizationId ?? undefined,
                },
              },
              {
                shipment: {
                  retailerOrgId: actor.organizationId ?? undefined,
                },
              },
            ],
          },
      include: INTERNAL_LOT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return lots.map((lot) => this.toInternalDto(lot, actor));
  }

  async getDashboard(actor: Actor) {
    const lots = await this.getList(actor);
    return {
      featuredLot: lots[0] ?? null,
      stats: [
        { label: 'Lô đang theo dõi', value: String(lots.length) },
        {
          label: 'Bằng chứng đang chờ',
          value: String(
            lots.filter((lot) => lot.proofStatus === 'PENDING').length,
          ),
        },
        {
          label: 'Chuyến vận chuyển mở',
          value: String(
            lots.filter((lot) =>
              ['CREATED', 'IN_TRANSIT', 'ARRIVED'].includes(
                lot.shipment?.status ?? '',
              ),
            ).length,
          ),
        },
      ],
    };
  }

  async getPublic(traceToken: string) {
    const qr = await this.prisma.traceQr.findUnique({
      where: { traceToken },
      include: {
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
      },
    });
    if (!qr) throw new NotFoundException('Mã truy xuất không hợp lệ');
    const { lot } = qr;
    const traceEvents = await this.prisma.traceEvent.findMany({
      where: {
        OR: [{ lotId: lot.id }, { cycleId: lot.harvest.cycle.id }],
      },
      orderBy: [{ eventTime: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        entityType: true,
        eventType: true,
        eventTime: true,
        dataHash: true,
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
      },
    });
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
      proofStatus: this.proofStatus(latest),
      timeline: traceEvents.map((event) => ({
        eventId: event.id,
        entityType: event.entityType,
        eventType: event.eventType,
        eventTime: event.eventTime,
        summary: this.eventSummary(event.eventType),
        proofStatus: this.proofStatus(event),
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

  private toInternalDto(lot: InternalLot, actor: Actor) {
    const latest = lot.traceEvents.at(-1);
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
      allowedCommands: this.allowedCommands(lot, actor),
      proofStatus: this.proofStatus(latest),
      timeline: lot.traceEvents.map((event) => ({
        eventId: event.id,
        entityType: event.entityType,
        eventType: event.eventType,
        eventTime: event.eventTime,
        summary: this.eventSummary(event.eventType),
        proofStatus: this.proofStatus(event),
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
          }
        : undefined,
    };
  }

  private allowedCommands(lot: InternalLot, actor: Actor) {
    const admin = actor.role === 'SYSTEM_ADMIN';
    if (!lot.shipment) {
      return lot.currentState === 'HARVESTED' &&
        (admin || actor.organizationId === lot.farmOrgId)
        ? ['createShipment']
        : [];
    }
    if (
      lot.shipment.status === 'CREATED' &&
      (admin || actor.organizationId === lot.shipment.transporterOrgId)
    )
      return ['startTransport'];
    if (
      lot.shipment.status === 'IN_TRANSIT' &&
      (admin || actor.organizationId === lot.shipment.transporterOrgId)
    )
      return ['reportArrival', 'reportDamage'];
    if (
      lot.shipment.status === 'ARRIVED' &&
      (admin || actor.organizationId === lot.shipment.retailerOrgId)
    )
      return ['receiveRetail', 'rejectRetail', 'reportDamage'];
    return [];
  }

  private proofStatus(event?: {
    dataHash: string;
    blockchainProof: null | {
      dataHash: string;
      transactionStatus: string;
    };
  }) {
    if (!event?.blockchainProof) return 'PENDING';
    if (event.blockchainProof.dataHash !== event.dataHash)
      return 'INTEGRITY_WARNING';
    if (event.blockchainProof.transactionStatus === 'CONFIRMED')
      return 'VERIFIED';
    if (event.blockchainProof.transactionStatus === 'FAILED')
      return 'BLOCKCHAIN_UNAVAILABLE';
    return 'PENDING';
  }

  private eventSummary(eventType: string) {
    const summaries: Record<string, string> = {
      PRODUCTION_CYCLE_CREATED: 'Khởi tạo chu kỳ sản xuất.',
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
      SHIPMENT_TELEMETRY_DIGEST_CREATED:
        'Chốt bản tổng hợp dữ liệu vận chuyển.',
      INSPECTION_RECORDED: 'Ghi nhận kết quả thanh tra.',
      CERTIFICATE_SUBMITTED: 'Gửi chứng chỉ để xét duyệt.',
      CERTIFICATE_APPROVED: 'Chứng chỉ đã được phê duyệt.',
      CERTIFICATE_REJECTED: 'Chứng chỉ bị từ chối.',
    };
    return summaries[eventType] ?? eventType.replaceAll('_', ' ').toLowerCase();
  }
}
