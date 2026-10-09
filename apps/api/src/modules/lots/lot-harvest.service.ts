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
import {
  assertBusinessActor,
  FARM_WRITE_ROLES,
} from '../auth/business-write.policy.js';
import { TraceService, type Actor } from '../trace/trace.service.js';
import type { RecordHarvestDto } from './dto.js';

@Injectable()
export class LotHarvestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly trace: TraceService,
  ) {}

  async recordHarvest(cycleId: string, input: RecordHarvestDto, actor: Actor) {
    assertBusinessActor(actor, FARM_WRITE_ROLES);
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
}
