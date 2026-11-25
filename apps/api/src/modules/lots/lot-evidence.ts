import { isPastExpiry } from '../../common/expiry-date.js';
import { reconcileQuantityMovements } from '../../common/quantity.js';
import { harvestSensorSnapshotMatches } from '../iot/harvest-sensor-window.js';
import { sensorWindowEventMatches } from '../iot/harvest-sensor-evidence.js';
import { privateTraceEvidenceMatches } from '../trace/trace-evidence.js';
import type { ProofEvent } from './lot-proof-status.js';
import type { InternalLot, PublicLot } from './lot-query.types.js';
import { lotStateMatchesShipment } from './lot-custody.js';

export function lotEvidence(
  lot: InternalLot | PublicLot,
  events: ProofEvent[],
) {
  // Processed lots carry no growing-period sensor window of their own.
  const processed = !lot.harvest;
  const window = lot.harvest?.sensorWindow ?? null;
  const finalized = events.filter(
    (event) =>
      event.lotId === lot.id && event.eventType === 'SENSOR_DIGEST_FINALIZED',
  );
  const harvested = events.filter(
    (event) => event.lotId === lot.id && event.eventType === 'HARVEST_RECORDED',
  );
  const validSensor =
    !!window &&
    harvestSensorSnapshotMatches(window) &&
    finalized.length === 1 &&
    harvested.length === 1 &&
    [...finalized, ...harvested].every(
      (event) =>
        privateTraceEvidenceMatches(event) &&
        sensorWindowEventMatches(window, lot.id, event),
    );
  const sensorStatus = processed
    ? 'NOT_APPLICABLE'
    : !window || !validSensor
      ? 'INTEGRITY_WARNING'
      : window.status === 'NO_DATA'
        ? 'NO_DATA'
        : 'FINALIZED';
  const quantityReconciled = reconcileQuantityMovements(
    lot,
    lot.quantityMovements,
  );
  const stateReconciled = lotStateMatchesShipment(lot);
  const expired = isPastExpiry(lot.expiryDate);
  const warnings: string[] = [];
  if (lot.currentState === 'RECALLED') warnings.push('RECALLED');
  if (lot.currentState === 'EXPIRED' || expired) warnings.push('EXPIRED');
  if (lot.currentState === 'DAMAGED') warnings.push('DAMAGED');
  if (lot.currentState === 'REJECTED') warnings.push('REJECTED');
  if (!quantityReconciled) warnings.push('QUANTITY_MISMATCH');
  if (!stateReconciled) warnings.push('STATE_MISMATCH');
  if (sensorStatus === 'NO_DATA') warnings.push('NO_DATA');
  if (sensorStatus === 'INTEGRITY_WARNING')
    warnings.push('SENSOR_INTEGRITY_WARNING');
  if ((lot.harvest?._count.lateReadings ?? 0) > 0) warnings.push('LATE_READINGS');
  return {
    quantityReconciled,
    stateReconciled,
    warnings,
    isExpired: expired,
    expiryDate: lot.expiryDate?.toISOString().slice(0, 10) ?? null,
    sensorEvidence: {
      status: sensorStatus,
      readingCount: window?.readingCount ?? 0,
      digestHash: validSensor ? window!.digestHash : null,
      periodStart: window?.periodStart.toISOString() ?? null,
      periodEnd: window?.periodEnd.toISOString() ?? null,
      finalizedAt: window?.finalizedAt.toISOString() ?? null,
      lateReadingCount: lot.harvest?._count.lateReadings ?? 0,
      simulated: !!window?.readings.some((r) => r.reading.device.simulated),
      ...sensorFigures(validSensor ? window!.readings.map((r) => r.reading) : []),
    },
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** Plain figures for shoppers: min/avg/max per sensor type over the sealed
 * window, and a daily average (Vietnam calendar day) for a small chart. The
 * sealed digest still covers the raw readings; these are only a view of them. */
export function sensorFigures(
  readings: { sensorType: string; unit: string; value: unknown; recordedAt: Date }[],
) {
  const byType = new Map<string, { unit: string; values: number[]; days: Map<string, number[]> }>();
  for (const r of readings) {
    const value = Number(String(r.value));
    if (!Number.isFinite(value)) continue;
    const entry = byType.get(r.sensorType) ?? { unit: r.unit, values: [] as number[], days: new Map<string, number[]>() };
    entry.values.push(value);
    const day = new Date(r.recordedAt.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
    entry.days.set(day, [...(entry.days.get(day) ?? []), value]);
    byType.set(r.sensorType, entry);
  }
  const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  return {
    summary: [...byType].map(([sensorType, e]) => ({
      sensorType,
      unit: e.unit,
      min: round1(Math.min(...e.values)),
      avg: round1(avg(e.values)),
      max: round1(Math.max(...e.values)),
    })),
    daily: [...byType].flatMap(([sensorType, e]) =>
      [...e.days].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ sensorType, day, avg: round1(avg(v)) })),
    ),
  };
}
