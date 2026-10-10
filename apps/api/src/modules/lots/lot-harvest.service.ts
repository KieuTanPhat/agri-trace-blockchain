import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  commandTransaction,
  lockAggregate,
} from '../../common/idempotency/command-transaction.js';
import { quantity } from '../../common/quantity.js';
import { normalizeExpiryDate } from '../../common/expiry-date.js';
import {
  prepareHarvestSensorWindow,
  finalizeHarvestSensorWindow,
} from '../iot/harvest-sensor-window.js';
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
    const harvestedQuantity = quantity(input.quantity);
    return commandTransaction(
      this.prisma,
      async (tx) => {
        await lockAggregate(tx, 'cycle', cycleId);
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
        const sensorSnapshot = await prepareHarvestSensorWindow(
          tx,
          cycleId,
          new Date(input.harvestTime),
          input.finalSensorDigestId,
        );
        const aggregate = await tx.harvestEvent.aggregate({
          where: { cycleId },
          _sum: { quantity: true },
        });
        const harvested = aggregate._sum.quantity ?? new Prisma.Decimal(0);
        const total = harvested.add(harvestedQuantity);
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
            quantity: harvestedQuantity,
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
            initialQuantity: harvestedQuantity,
            availableQuantity: harvestedQuantity,
            unit: input.unit,
            grade: input.grade,
            expiryDate: input.expiryDate
              ? normalizeExpiryDate(input.expiryDate)
              : undefined,
          },
        });
        const sensorWindow = await finalizeHarvestSensorWindow(
          tx,
          sensorSnapshot,
          harvest.id,
        );
        await this.trace.createInTransaction(tx, {
          entityType: 'SENSOR_DIGEST',
          entityId: sensorWindow.id,
          cycleId,
          lotId: lot.id,
          eventType: 'SENSOR_DIGEST_FINALIZED',
          actor,
          eventTime: harvest.harvestTime,
          businessData: {
            windowId: sensorWindow.id,
            harvestId: harvest.id,
            periodStart: sensorWindow.periodStart.toISOString(),
            periodEnd: sensorWindow.periodEnd.toISOString(),
            includeStart: sensorWindow.includeStart,
            status: sensorWindow.status,
            digestHash: sensorWindow.digestHash,
            readingCount: sensorWindow.readingCount,
            schemaVersion: sensorWindow.schemaVersion,
            reconciliationId: sensorWindow.reconciliationId,
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
            quantity: harvestedQuantity.toString(),
            unit: input.unit,
            grade: input.grade ?? null,
            sensorWindowId: sensorWindow.id,
            sensorEvidenceStatus: sensorWindow.status,
          },
        });
        await tx.quantityMovement.create({
          data: {
            lotId: lot.id,
            eventId: event.id,
            type: 'HARVEST_IN',
            quantity: harvestedQuantity,
            unit: input.unit,
            beforeQty: 0,
            delta: harvestedQuantity,
            afterQty: harvestedQuantity,
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
        await tx.productionCycle.update({
          where: { id: cycleId },
          data: { version: { increment: 1 } },
        });
        return {
          harvest,
          lot,
          traceQr,
          sensorWindow,
          cycleVersion: cycle.version + 1,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 30000,
      },
    );
  }
}
