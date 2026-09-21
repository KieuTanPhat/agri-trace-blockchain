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
      include: {
        product: true,
        organization: true,
        harvest: {
          include: { cycle: { include: { farm: true, plot: true } } },
        },
        shipment: { include: { transporter: true, retailer: true } },
        quantityMovements: { orderBy: { createdAt: 'asc' } },
        traceEvents: {
          orderBy: { eventTime: 'asc' },
          include: { blockchainProof: true },
        },
        certificates: true,
        inspections: true,
        traceQr: true,
      },
    });
    if (!lot) throw new NotFoundException('Không tìm thấy lô hàng');
    return lot;
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
              where: { isPublic: true },
              select: {
                type: true,
                issuer: true,
                issueDate: true,
                expiryDate: true,
                documentHash: true,
              },
            },
            traceEvents: {
              orderBy: { eventTime: 'asc' },
              select: {
                eventType: true,
                eventTime: true,
                dataHash: true,
                blockchainProof: {
                  select: {
                    transactionStatus: true,
                    txId: true,
                    channelId: true,
                    recordedAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!qr) throw new NotFoundException('Mã truy xuất không hợp lệ');
    const { lot } = qr;
    return {
      lotCode: lot.lotCode,
      state: lot.currentState,
      quantity: lot.initialQuantity,
      unit: lot.unit,
      product: { name: lot.product.productName, variety: lot.product.variety },
      origin: {
        farm: lot.harvest.cycle.farm.name,
        location: lot.harvest.cycle.farm.location,
        harvestedAt: lot.harvest.harvestTime,
      },
      shipment: lot.shipment,
      certificates: lot.certificates,
      timeline: lot.traceEvents,
    };
  }
}
