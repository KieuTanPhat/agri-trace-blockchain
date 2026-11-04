import type { Prisma } from '../../generated/prisma/client.js';
import { provinceCenter } from '../../common/locations/province-centers.js';
import { distanceMeters } from './route-seal.js';

/** Road length is longer than the straight line between two points. */
export const ROAD_FACTOR = 1.3;
/** Average truck speed used for the planned duration (km/h). */
export const PLANNED_KMH = 45;

export type TransferPlace = {
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** SITE: the site's own map point; PROVINCE: representative province point. */
  source: 'SITE' | 'PROVINCE' | null;
};

type Site = { name: string; region: string | null; latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null } | null;

function place(site: Site, fallbackName: string): TransferPlace {
  if (site?.latitude != null && site.longitude != null)
    return { name: site.name, latitude: Number(site.latitude.toString()), longitude: Number(site.longitude.toString()), source: 'SITE' };
  const center = provinceCenter(site?.region);
  if (center) return { name: site?.name ?? fallbackName, latitude: center.latitude, longitude: center.longitude, source: 'PROVINCE' };
  return { name: site?.name ?? fallbackName, latitude: null, longitude: null, source: null };
}

/**
 * Pickup and delivery points of a transfer and the planned distance (ADR-006).
 * A site without a map point falls back to a representative province point, so a
 * route can be estimated from the province of each party.
 */
export async function transferPlaces(
  db: Prisma.TransactionClient,
  t: { senderSiteId: string | null; receiverSiteId: string | null; origin: string; destination: string },
) {
  const select = { name: true, region: true, latitude: true, longitude: true } as const;
  const [sender, receiver] = await Promise.all([
    t.senderSiteId ? db.enterpriseSite.findUnique({ where: { id: t.senderSiteId }, select }) : null,
    t.receiverSiteId ? db.enterpriseSite.findUnique({ where: { id: t.receiverSiteId }, select }) : null,
  ]);
  const origin = place(sender, t.origin);
  const destination = place(receiver, t.destination);
  const known = origin.latitude != null && destination.latitude != null;
  const straight = known
    ? distanceMeters(
        { latitude: origin.latitude!, longitude: origin.longitude! },
        { latitude: destination.latitude!, longitude: destination.longitude! },
      )
    : null;
  const distanceM = straight == null ? null : Math.round(straight * ROAD_FACTOR);
  return {
    origin,
    destination,
    planned: distanceM == null ? null : { distanceM, durationS: Math.round(distanceM / (PLANNED_KMH / 3.6)), estimated: true },
  };
}
