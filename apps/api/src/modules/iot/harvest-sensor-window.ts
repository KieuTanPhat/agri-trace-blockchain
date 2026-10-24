import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import type { Prisma, SensorReading } from '../../generated/prisma/client.js';

export async function plantedTime(
  db: Prisma.TransactionClient,
  cycleId: string,
): Promise<Date | null> {
  const events = await db.traceEvent.findMany({
    where: {
      cycleId,
      entityType: 'PRODUCTION_CYCLE',
      eventType: 'CYCLE_PLANTED',
    },
    select: { businessData: true },
    take: 2,
  });
  if (events.length !== 1) return null;
  const data = events[0].businessData;
  const value =
    data && typeof data === 'object' && !Array.isArray(data)
      ? data.plantedAt
      : null;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function validateSensorTime(
  db: Prisma.TransactionClient,
  cycleId: string,
  value: Date,
): Promise<void> {
  if (!Number.isFinite(value.getTime()) || value.getTime() > Date.now())
    throw new UnprocessableEntityException(
      'Thời gian cảm biến không hợp lệ hoặc ở tương lai',
    );
  const plantedAt = await plantedTime(db, cycleId);
  if (plantedAt && value < plantedAt)
    throw new UnprocessableEntityException(
      'Thời gian cảm biến trước khi trồng',
    );
}

export async function markLateReading(
  db: Prisma.TransactionClient,
  reading: Pick<SensorReading, 'id' | 'cycleId' | 'recordedAt'>,
): Promise<boolean> {
  const closed = await db.harvestEvent.findFirst({
    where: {
      cycleId: reading.cycleId,
      harvestTime: { gte: reading.recordedAt },
    },
    orderBy: [{ harvestTime: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (!closed) return false;
  await db.lateSensorReading.create({
    data: { readingId: reading.id, closedHarvestId: closed.id },
  });
  return true;
}

export async function prepareHarvestSensorWindow(
  db: Prisma.TransactionClient,
  cycleId: string,
  periodEnd: Date,
) {
  const [previous, plantedAt] = await Promise.all([
    db.harvestSensorWindow.findFirst({
      where: { cycleId },
      orderBy: { periodEnd: 'desc' },
    }),
    plantedTime(db, cycleId),
  ]);
  if (!plantedAt)
    throw new ConflictException('Chu kỳ chưa có mốc CYCLE_PLANTED');
  const periodStart = previous?.periodEnd ?? plantedAt;
  const includeStart = !previous;
  if (
    !Number.isFinite(periodEnd.getTime()) ||
    periodEnd <= periodStart ||
    periodEnd.getTime() > Date.now()
  )
    throw new UnprocessableEntityException(
      'Cutoff thu hoạch phải tăng và không được ở tương lai',
    );
  const readings = await db.sensorReading.findMany({
    where: {
      cycleId,
      recordedAt: {
        ...(includeStart ? { gte: periodStart } : { gt: periodStart }),
        lte: periodEnd,
      },
      harvestMembership: null,
      lateMarker: null,
    },
    orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
  });
  return {
    cycleId,
    periodStart,
    periodEnd,
    includeStart,
    readings,
  };
}

export function readingSnapshot(readings: SensorReading[]) {
  return readings.map((reading) => ({
    id: reading.id,
    deviceId: reading.deviceId,
    sensorType: reading.sensorType,
    value: reading.value.toString(),
    unit: reading.unit,
    recordedAt: reading.recordedAt.toISOString(),
  }));
}

export async function finalizeHarvestSensorWindow(
  db: Prisma.TransactionClient,
  prepared: Awaited<ReturnType<typeof prepareHarvestSensorWindow>>,
  harvestId: string,
) {
  const { readings, ...window } = prepared;
  const digestHash = readings.length
    ? canonicalSha256({
        schemaVersion: 'harvest-sensor-1',
        cycleId: window.cycleId,
        harvestId,
        periodStart: window.periodStart.toISOString(),
        periodEnd: window.periodEnd.toISOString(),
        includeStart: window.includeStart,
        // Fixed by the harvest-sensor-1 layout; reconciliation is retired.
        reconciliationId: null,
        readings: readingSnapshot(readings),
      })
    : null;
  const created = await db.harvestSensorWindow.create({
    data: {
      ...window,
      harvestId,
      status: readings.length ? 'FINALIZED' : 'NO_DATA',
      readingCount: readings.length,
      digestHash,
    },
  });
  if (readings.length)
    await db.harvestSensorMembership.createMany({
      data: readings.map((reading) => ({
        windowId: created.id,
        readingId: reading.id,
      })),
    });
  return db.harvestSensorWindow.update({
    where: { id: created.id },
    data: { sealedAt: new Date() },
  });
}

export type HarvestSensorSnapshot = Prisma.HarvestSensorWindowGetPayload<{
  include: {
    readings: { include: { reading: true } };
    harvest: { select: { cycleId: true; harvestTime: true } };
  };
}>;

export function harvestSensorSnapshotMatches(
  window: HarvestSensorSnapshot | null,
): boolean {
  if (
    !window?.sealedAt ||
    window.schemaVersion !== 'harvest-sensor-1' ||
    window.harvest.cycleId !== window.cycleId ||
    window.harvest.harvestTime.getTime() !== window.periodEnd.getTime() ||
    window.periodEnd <= window.periodStart ||
    window.sealedAt < window.finalizedAt ||
    !Number.isInteger(window.readingCount) ||
    window.readingCount < 0 ||
    window.readings.length !== window.readingCount
  )
    return false;
  const readings = window.readings
    .map((member) => member.reading)
    .sort(
      (a, b) =>
        a.recordedAt.getTime() - b.recordedAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  if (
    readings.some(
      (reading) =>
        reading.cycleId !== window.cycleId ||
        reading.recordedAt > window.periodEnd ||
        (window.includeStart
          ? reading.recordedAt < window.periodStart
          : reading.recordedAt <= window.periodStart),
    )
  )
    return false;
  if (!readings.length)
    return window.status === 'NO_DATA' && window.digestHash === null;
  return (
    window.status === 'FINALIZED' &&
    window.digestHash ===
      canonicalSha256({
        schemaVersion: 'harvest-sensor-1',
        cycleId: window.cycleId,
        harvestId: window.harvestId,
        periodStart: window.periodStart.toISOString(),
        periodEnd: window.periodEnd.toISOString(),
        includeStart: window.includeStart,
        reconciliationId: null,
        readings: readingSnapshot(readings),
      })
  );
}
