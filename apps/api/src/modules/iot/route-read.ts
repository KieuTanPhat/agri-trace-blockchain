import type {
  DistributionTransfer,
  Prisma,
} from '../../generated/prisma/client.js';
import { siteArrivalPoint, transferPlaces } from './transfer-places.js';
import {
  decimalNumber,
  distanceMeters,
  longStops,
  ROUTE_RULES,
  summarizeRoute,
  type RoutePoint,
} from './route-seal.js';

const MAX_POINTS = 2000;

/**
 * Route view for transfer participants (ADR-006). Warnings are derived on read:
 * signal gaps, long stops away from the destination and arrival near the
 * receiver site. Positions keep their original recorded instants.
 */
export async function transferRoute(db: Prisma.TransactionClient, t: DistributionTransfer) {
  const [vehicle, tracker, rows, seal, places, arrival] = await Promise.all([
    t.vehicleId
      ? db.enterpriseVehicle.findUnique({ where: { id: t.vehicleId }, select: { id: true, registration: true, kind: true } })
      : null,
    t.vehicleId
      ? db.iotDevice.findFirst({
          where: { vehicleId: t.vehicleId, status: 'ACTIVE' },
          select: { id: true, deviceCode: true, name: true, simulated: true, lastSeenAt: true },
        })
      : null,
    db.distributionPosition.findMany({
      where: { transferId: t.id },
      orderBy: [{ recordedAt: 'asc' }, { deviceSequence: 'asc' }],
      include: { device: { select: { simulated: true } } },
    }),
    db.distributionRouteSeal.findUnique({ where: { transferId: t.id } }),
    transferPlaces(db, t),
    db.distributionArrival.findUnique({
      where: { transferId: t.id },
      select: { source: true, arrivedAt: true, reason: true, organizationId: true, latitude: true, longitude: true },
    }),
  ]);
  const points: (RoutePoint & {
    speedKmh: number | null;
    heading: number | null;
    battery: number | null;
    anomalyCode: string | null;
    receivedAt: Date;
  })[] = rows.map((r) => ({
    sequence: r.deviceSequence,
    recordedAt: r.recordedAt,
    receivedAt: r.receivedAt,
    latitude: Number(r.latitude.toString()),
    longitude: Number(r.longitude.toString()),
    accuracyM: decimalNumber(r.accuracyM),
    speedKmh: decimalNumber(r.speedKmh),
    heading: decimalNumber(r.heading),
    battery: decimalNumber(r.battery),
    validity: r.validity,
    anomalyCode: r.anomalyCode,
  }));
  const { origin, destination, planned } = places;
  // Arrival is only judged against a site's own map point, not a province centre.
  const destinationPoint =
    destination.source === 'SITE' && destination.latitude != null && destination.longitude != null
      ? { latitude: destination.latitude, longitude: destination.longitude }
      : null;
  const end = t.deliveredAt ?? new Date();
  const start = t.inTransitAt;
  const summary = start
    ? summarizeRoute(points.filter((p) => p.validity !== 'LATE'), start, end)
    : null;
  const valid = points.filter((p) => p.validity === 'VALID');
  const last = valid.at(-1) ?? null;
  const warnings: { code: string; from?: string; to?: string; seconds?: number }[] = [];
  if (summary)
    for (const g of summary.gaps)
      // An open trailing gap is still a lost signal while the vehicle moves.
      warnings.push({ code: 'SIGNAL_GAP', from: g.from.toISOString(), to: g.to.toISOString(), seconds: g.seconds });
  for (const s of longStops(valid, destinationPoint))
    warnings.push({ code: 'LONG_STOP', from: s.from.toISOString(), to: s.to.toISOString(), seconds: s.seconds });
  const anomalies = points.filter((p) => p.validity === 'ANOMALY').length;
  if (anomalies) warnings.push({ code: 'ANOMALY_POINTS', seconds: anomalies });
  const nearDestination =
    !!last && !!destinationPoint && distanceMeters(last, destinationPoint) <= ROUTE_RULES.arrivalRadiusM;
  const trackable = t.transportMode !== 'EXTERNAL_CARRIER' && !!t.vehicleId && !!tracker;
  const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
  const shown = points.filter((p, i) => p.validity !== 'VALID' || i % step === 0 || i === points.length - 1);
  return {
    transferId: t.id,
    status: t.status,
    transportMode: t.transportMode,
    trackable: t.transportMode !== 'EXTERNAL_CARRIER' && !!t.vehicleId,
    vehicle,
    tracker,
    source: seal?.source ?? (!valid.length ? 'NONE' : rows.some((r) => r.device.simulated) ? 'SIMULATED' : 'DEVICE'),
    window: { inTransitAt: t.inTransitAt, deliveredAt: t.deliveredAt },
    origin,
    destination,
    planned,
    arrived: !!arrival,
    nearDestination,
    arrival: arrival && {
      source: arrival.source,
      arrivedAt: arrival.arrivedAt,
      reason: arrival.reason,
      latitude: decimalNumber(arrival.latitude),
      longitude: decimalNumber(arrival.longitude),
    },
    // A carrier confirming arrival against a GPS that can judge it gives a reason.
    arrivalNeedsReason: !arrival && trackable && !!destinationPoint && !nearDestination,
    lastPosition: last && {
      recordedAt: last.recordedAt,
      latitude: last.latitude,
      longitude: last.longitude,
      speedKmh: last.speedKmh,
      heading: last.heading,
      battery: last.battery,
    },
    summary: summary && {
      pointCount: summary.pointCount,
      anomalyCount: summary.anomalyCount,
      distanceM: summary.distanceM,
      coveragePercent: summary.coveragePercent,
      maxGapSeconds: summary.maxGapSeconds,
    },
    warnings,
    seal,
    points: shown.map((p) => ({
      sequence: String(p.sequence),
      recordedAt: p.recordedAt,
      receivedAt: p.receivedAt,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracyM: p.accuracyM ?? null,
      speedKmh: p.speedKmh,
      heading: p.heading,
      validity: p.validity,
      anomalyCode: p.anomalyCode,
    })),
  };
}

/**
 * Whether a carrier confirming arrival must give a reason: the vehicle GPS can
 * judge arrival (tracked vehicle, receiver site with its own map point) and its
 * latest valid fix is not within the arrival radius.
 */
export async function arrivalNeedsReason(db: Prisma.TransactionClient, t: DistributionTransfer) {
  if (t.transportMode === 'EXTERNAL_CARRIER' || !t.vehicleId) return false;
  const [tracker, destination, last] = await Promise.all([
    db.iotDevice.findFirst({ where: { vehicleId: t.vehicleId, status: 'ACTIVE' }, select: { id: true } }),
    siteArrivalPoint(db, t.receiverSiteId),
    db.distributionPosition.findFirst({
      where: { transferId: t.id, validity: 'VALID' },
      orderBy: [{ recordedAt: 'desc' }, { deviceSequence: 'desc' }],
      select: { latitude: true, longitude: true },
    }),
  ]);
  if (!tracker || !destination) return false;
  return !last || distanceMeters({ latitude: Number(last.latitude), longitude: Number(last.longitude) }, destination) > ROUTE_RULES.arrivalRadiusM;
}
