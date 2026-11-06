import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** ADR-006 thresholds. Kept here so ingest, read model and seal agree. */
export const ROUTE_RULES = {
  /** Implied speed between two valid points above this is a GPS jump. */
  maxPlausibleKmh: 180,
  /** Reported accuracy worse than this is not used for the route. */
  maxAccuracyM: 100,
  /** A silence longer than this is a signal gap (not covered). */
  gapSeconds: 600,
  /** Stationary for longer than this away from the destination is a long stop. */
  longStopSeconds: 1800,
  /** Moving less than this is considered stationary. */
  stationaryRadiusM: 150,
  /** Within this distance of the receiver site the vehicle has arrived. */
  arrivalRadiusM: 300,
} as const;

export type RoutePoint = {
  sequence: bigint | number;
  recordedAt: Date;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  validity: string;
};

export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const r = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Classifies a new point against the previous VALID point of the same transfer. */
export function classifyPosition(
  previous: Pick<RoutePoint, 'recordedAt' | 'latitude' | 'longitude'> | null,
  point: Pick<RoutePoint, 'recordedAt' | 'latitude' | 'longitude' | 'accuracyM'>,
): string | null {
  if (point.accuracyM != null && point.accuracyM > ROUTE_RULES.maxAccuracyM)
    return 'LOW_ACCURACY';
  if (!previous) return null;
  const seconds = Math.abs(
    (point.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000,
  );
  const meters = distanceMeters(previous, point);
  // Points in the same second still jump if they are far apart.
  const kmh = (meters / 1000) / (Math.max(seconds, 1) / 3600);
  return kmh > ROUTE_RULES.maxPlausibleKmh && meters > 500 ? 'JUMP' : null;
}

type RouteSummary = {
  pointCount: number;
  anomalyCount: number;
  distanceM: number;
  coveragePercent: number;
  maxGapSeconds: number;
  periodStart: Date;
  periodEnd: Date;
  gaps: { from: Date; to: Date; seconds: number }[];
};

/** Distance, coverage and gaps over [start, end] using VALID points only. */
export function summarizeRoute(
  points: RoutePoint[],
  start: Date,
  end: Date,
): RouteSummary {
  const valid = points
    .filter((p) => p.validity === 'VALID')
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  const anomalyCount = points.filter((p) => p.validity === 'ANOMALY').length;
  let distance = 0;
  for (let i = 1; i < valid.length; i++)
    distance += distanceMeters(valid[i - 1], valid[i]);
  const marks = [start, ...valid.map((p) => p.recordedAt), end];
  const gaps: RouteSummary['gaps'] = [];
  let uncovered = 0;
  let maxGap = 0;
  for (let i = 1; i < marks.length; i++) {
    const seconds = Math.max(
      0,
      (marks[i].getTime() - marks[i - 1].getTime()) / 1000,
    );
    maxGap = Math.max(maxGap, seconds);
    if (seconds > ROUTE_RULES.gapSeconds) {
      uncovered += seconds;
      gaps.push({ from: marks[i - 1], to: marks[i], seconds: Math.round(seconds) });
    }
  }
  const total = Math.max(1, (end.getTime() - start.getTime()) / 1000);
  const coverage = valid.length
    ? Math.max(0, Math.min(100, 100 * (1 - uncovered / total)))
    : 0;
  return {
    pointCount: valid.length,
    anomalyCount,
    distanceM: Math.round(distance),
    coveragePercent: Math.round(coverage * 100) / 100,
    maxGapSeconds: Math.round(maxGap),
    periodStart: start,
    periodEnd: end,
    gaps,
  };
}

/** Stationary periods longer than the threshold away from the destination. */
export function longStops(
  points: RoutePoint[],
  destination: { latitude: number; longitude: number } | null,
) {
  const valid = points
    .filter((p) => p.validity === 'VALID')
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  const stops: { from: Date; to: Date; seconds: number; latitude: number; longitude: number }[] = [];
  let anchor = 0;
  const flush = (endIndex: number) => {
    const a = valid[anchor];
    const b = valid[endIndex];
    const seconds = (b.recordedAt.getTime() - a.recordedAt.getTime()) / 1000;
    const atDestination =
      destination && distanceMeters(a, destination) <= ROUTE_RULES.arrivalRadiusM;
    if (seconds >= ROUTE_RULES.longStopSeconds && !atDestination)
      stops.push({ from: a.recordedAt, to: b.recordedAt, seconds: Math.round(seconds), latitude: a.latitude, longitude: a.longitude });
  };
  for (let i = 1; i < valid.length; i++) {
    if (distanceMeters(valid[anchor], valid[i]) > ROUTE_RULES.stationaryRadiusM) {
      if (i - 1 > anchor) flush(i - 1);
      anchor = i;
    }
  }
  if (valid.length > 1 && valid.length - 1 > anchor) flush(valid.length - 1);
  return stops;
}

export function routeDigest(transferId: string, points: RoutePoint[]) {
  const valid = points
    .filter((p) => p.validity === 'VALID')
    .sort((a, b) =>
      a.recordedAt.getTime() - b.recordedAt.getTime() ||
      Number(BigInt(a.sequence) - BigInt(b.sequence)),
    );
  return canonicalSha256({
    schemaVersion: 'distribution-route-1',
    transferId,
    points: valid.map((p) => ({
      sequence: String(p.sequence),
      recordedAt: p.recordedAt.toISOString(),
      latitude: p.latitude.toFixed(6),
      longitude: p.longitude.toFixed(6),
    })),
  });
}

export function decimalNumber(value: Prisma.Decimal | null | undefined) {
  return value == null ? null : Number(value.toString());
}

type SealSource = 'DEVICE' | 'SIMULATED' | 'NONE';

/**
 * Seals the transit route inside the DELIVERY transaction. Returns the business
 * data that is added to the DISTRIBUTION_DELIVERED trace event.
 */
export async function sealRoute(
  tx: Prisma.TransactionClient,
  transfer: { id: string; inTransitAt: Date | null },
  deliveredAt: Date,
) {
  const start = transfer.inTransitAt ?? deliveredAt;
  const rows = await tx.distributionPosition.findMany({
    where: { transferId: transfer.id },
    include: { device: { select: { simulated: true } } },
  });
  const points: RoutePoint[] = rows.map((r) => ({
    sequence: r.deviceSequence,
    recordedAt: r.recordedAt,
    latitude: Number(r.latitude.toString()),
    longitude: Number(r.longitude.toString()),
    accuracyM: decimalNumber(r.accuracyM),
    validity: r.validity,
  }));
  const summary = summarizeRoute(points, start, deliveredAt);
  const source: SealSource = !summary.pointCount
    ? 'NONE'
    : rows.some((r) => r.device.simulated)
      ? 'SIMULATED'
      : 'DEVICE';
  const digestHash = routeDigest(transfer.id, points);
  await tx.distributionRouteSeal.create({
    data: {
      transferId: transfer.id,
      digestHash,
      source,
      pointCount: summary.pointCount,
      anomalyCount: summary.anomalyCount,
      distanceM: summary.distanceM,
      coveragePercent: summary.coveragePercent,
      maxGapSeconds: summary.maxGapSeconds,
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
    },
  });
  return {
    schemaVersion: 'distribution-route-1',
    digestHash,
    source,
    pointCount: summary.pointCount,
    anomalyCount: summary.anomalyCount,
    distanceM: summary.distanceM,
    coveragePercent: summary.coveragePercent.toFixed(2),
    maxGapSeconds: summary.maxGapSeconds,
    periodStart: summary.periodStart.toISOString(),
    periodEnd: summary.periodEnd.toISOString(),
  };
}
