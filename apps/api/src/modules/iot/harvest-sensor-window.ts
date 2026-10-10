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
  const known = await plantedTime(db, cycleId);
  const reconciliation = known
    ? null
    : await db.cycleSensorReconciliation.findFirst({
        where: { cycleId },
        orderBy: { revision: 'desc' },
      });
  const plantedAt = known ?? reconciliation?.plantedAt;
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
  finalSensorDigestId?: string,
) {
  const [previous, legacy, reconciliation, planted] = await Promise.all([
    db.harvestSensorWindow.findFirst({
      where: { cycleId },
      orderBy: { periodEnd: 'desc' },
    }),
    db.harvestEvent.findMany({
      where: { cycleId, sensorWindow: null },
      orderBy: [{ harvestTime: 'desc' }, { id: 'desc' }],
      select: { id: true, harvestTime: true },
    }),
    db.cycleSensorReconciliation.findFirst({
      where: { cycleId },
      orderBy: { revision: 'desc' },
    }),
    plantedTime(db, cycleId),
  ]);
  if (
    legacy.length &&
    (!reconciliation ||
      reconciliation.throughHarvestId !== legacy[0].id ||
      !reconciliation.cutoffEnd ||
      legacy.some((item) => item.harvestTime > reconciliation.cutoffEnd!))
  )
    throw new ConflictException(
      'LEGACY_UNVERIFIED: cần đối soát cutoff các harvest cũ trước khi thu hoạch tiếp',
    );
  const plantedAt = reconciliation?.plantedAt ?? planted;
  if (!plantedAt)
    throw new ConflictException(
      'LEGACY_UNVERIFIED: chưa có mốc CYCLE_PLANTED đáng tin cậy',
    );
  const periodStart =
    previous?.periodEnd ?? reconciliation?.cutoffEnd ?? plantedAt;
  const includeStart = !previous && !reconciliation?.cutoffEnd;
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
  if (finalSensorDigestId) {
    const digest = await db.sensorDigest.findUnique({
      where: { id: finalSensorDigestId },
      include: { harvestEvent: { select: { id: true } } },
    });
    const expected = canonicalSha256({
      schemaVersion: 'sensor-digest-1',
      cycleId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      readings: readingSnapshot(readings),
    });
    if (
      !digest ||
      digest.cycleId !== cycleId ||
      !digest.isFinal ||
      digest.harvestEvent ||
      !includeStart ||
      digest.periodStart.getTime() !== periodStart.getTime() ||
      digest.periodEnd.getTime() !== periodEnd.getTime() ||
      digest.readingCount !== readings.length ||
      digest.digestHash !== expected ||
      !readings.length
    )
      throw new UnprocessableEntityException(
        'Legacy digest không khớp snapshot/window hoặc đã được sử dụng',
      );
  }
  return {
    cycleId,
    periodStart,
    periodEnd,
    includeStart,
    readings,
    reconciliationId: reconciliation?.id ?? null,
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
        reconciliationId: window.reconciliationId,
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

export async function harvestSensorEvidenceMatches(
  db: Prisma.TransactionClient,
  windowId: string,
): Promise<boolean> {
  const window = await db.harvestSensorWindow.findUnique({
    where: { id: windowId },
    include: {
      readings: { include: { reading: true } },
      harvest: { select: { cycleId: true, harvestTime: true } },
    },
  });
  if (
    !window?.sealedAt ||
    window.schemaVersion !== 'harvest-sensor-1' ||
    window.harvest.cycleId !== window.cycleId ||
    window.harvest.harvestTime.getTime() !== window.periodEnd.getTime() ||
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
        reconciliationId: window.reconciliationId,
        readings: readingSnapshot(readings),
      })
  );
}
