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
  const window = lot.harvest.sensorWindow;
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
  const sensorStatus = !window
    ? 'LEGACY_UNVERIFIED'
    : !validSensor
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
  if (sensorStatus === 'LEGACY_UNVERIFIED') warnings.push('LEGACY_UNVERIFIED');
  if (sensorStatus === 'INTEGRITY_WARNING')
    warnings.push('SENSOR_INTEGRITY_WARNING');
  if (lot.harvest._count.lateReadings > 0) warnings.push('LATE_READINGS');
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
      lateReadingCount: lot.harvest._count.lateReadings,
    },
  };
}
