import type { Prisma, TraceEvent } from '../../generated/prisma/client.js';
import {
  harvestSensorSnapshotMatches,
  type HarvestSensorSnapshot,
} from './harvest-sensor-window.js';

type SensorTraceEvent = Pick<
  TraceEvent,
  'entityType' | 'entityId' | 'cycleId' | 'lotId' | 'eventType' | 'eventTime'
> & { businessData: unknown };

function businessObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function sensorWindowEventMatches(
  window: HarvestSensorSnapshot,
  lotId: string,
  event: SensorTraceEvent,
): boolean {
  const data = businessObject(event.businessData);
  if (!data) return false;
  const common =
    event.cycleId === window.cycleId &&
    event.lotId === lotId &&
    event.eventTime.getTime() === window.periodEnd.getTime();
  if (event.eventType === 'HARVEST_RECORDED')
    return (
      common &&
      event.entityType === 'HARVEST' &&
      event.entityId === window.harvestId &&
      data.sensorWindowId === window.id &&
      data.sensorEvidenceStatus === window.status
    );
  return (
    common &&
    event.entityType === 'SENSOR_DIGEST' &&
    event.eventType === 'SENSOR_DIGEST_FINALIZED' &&
    event.entityId === window.id &&
    data.windowId === window.id &&
    data.harvestId === window.harvestId &&
    data.periodStart === window.periodStart.toISOString() &&
    data.periodEnd === window.periodEnd.toISOString() &&
    data.includeStart === window.includeStart &&
    data.status === window.status &&
    data.digestHash === window.digestHash &&
    data.readingCount === window.readingCount &&
    data.schemaVersion === window.schemaVersion &&
    data.reconciliationId === window.reconciliationId
  );
}

/** Legacy cycle-level digests keep their historical contract; new harvest events must bind the entire window. */
export async function harvestSensorTraceEvidenceMatches(
  db: Prisma.TransactionClient,
  event: SensorTraceEvent,
): Promise<boolean> {
  if (
    !['HARVEST_RECORDED', 'SENSOR_DIGEST_FINALIZED'].includes(event.eventType)
  )
    return true;
  const object = businessObject(event.businessData);
  if (
    event.eventType === 'SENSOR_DIGEST_FINALIZED' &&
    !event.lotId &&
    !object?.windowId
  ) {
    const digest = await db.sensorDigest.findUnique({
      where: { id: event.entityId },
    });
    return (
      !!digest &&
      event.entityType === 'SENSOR_DIGEST' &&
      event.cycleId === digest.cycleId &&
      digest.isFinal &&
      object?.digestHash === digest.digestHash &&
      object.periodStart === digest.periodStart.toISOString() &&
      object.periodEnd === digest.periodEnd.toISOString() &&
      object.readingCount === digest.readingCount &&
      object.isFinal === true
    );
  }
  const window = await db.harvestSensorWindow.findUnique({
    where:
      event.eventType === 'HARVEST_RECORDED'
        ? { harvestId: event.entityId }
        : { id: event.entityId },
    include: {
      readings: { include: { reading: true } },
      harvest: { select: { cycleId: true, harvestTime: true } },
    },
  });
  if (!window)
    return (
      event.eventType === 'HARVEST_RECORDED' &&
      !object?.sensorWindowId &&
      !object?.sensorEvidenceStatus
    );
  const lot = await db.lot.findUnique({
    where: { harvestId: window.harvestId },
    select: { id: true },
  });
  return (
    !!lot &&
    harvestSensorSnapshotMatches(window) &&
    sensorWindowEventMatches(window, lot.id, event)
  );
}
