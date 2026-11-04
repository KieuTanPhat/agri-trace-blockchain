// Builds a drivable route between any two points (ADR-006 virtual devices).
// Real roads come from the public OSRM demo server on OpenStreetMap data and are
// cached on disk, so a route used once also works offline. Without network a
// clearly labelled estimate is generated (straight line × 1.3 road factor).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { distanceMeters } from './device-models.mjs';

const OSRM = process.env.IOT_SIM_OSRM_URL ?? 'https://router.project-osrm.org';

function thin(coords) {
  const keep = [coords[0]];
  for (const p of coords.slice(1)) if (distanceMeters(keep.at(-1), p) >= 40) keep.push(p);
  if (keep.at(-1) !== coords.at(-1)) keep.push(coords.at(-1));
  return keep;
}

/** Gently curved line between two points; road length ≈ 1.3 × straight line. */
function estimate(from, to) {
  const straight = distanceMeters([from.latitude, from.longitude], [to.latitude, to.longitude]);
  const steps = Math.max(20, Math.round(straight / 500));
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    // Sideways bulge of up to 8% of the distance, so the path is not a ruler line.
    const bulge = Math.sin(f * Math.PI) * 0.08 + Math.sin(f * Math.PI * 6) * 0.01;
    const lat = from.latitude + (to.latitude - from.latitude) * f - (to.longitude - from.longitude) * bulge;
    const lng = from.longitude + (to.longitude - from.longitude) * f + (to.latitude - from.latitude) * bulge;
    coords.push([+lat.toFixed(6), +lng.toFixed(6)]);
  }
  return { coordinates: coords, distanceM: Math.round(straight * 1.3), durationS: Math.round((straight * 1.3) / (45 / 3.6)), estimated: true };
}

async function osrm(from, to) {
  const url = `${OSRM}/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'agritrace-iot-simulator' } });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const j = await res.json();
  const r = j.routes?.[0];
  if (j.code !== 'Ok' || !r) throw new Error(`OSRM ${j.code}`);
  return {
    coordinates: thin(r.geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(6), +lng.toFixed(6)])),
    distanceM: Math.round(r.distance),
    // OSRM car speeds are optimistic for trucks; the simulator drives slower anyway.
    durationS: Math.round(r.duration),
    estimated: false,
  };
}

export async function planRoute(cacheDir, from, to) {
  const key = createHash('sha256').update(JSON.stringify([from.latitude, from.longitude, to.latitude, to.longitude].map((v) => v.toFixed(4)))).digest('hex').slice(0, 16);
  const file = join(cacheDir, `${key}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    /* not cached */
  }
  let path;
  let source;
  try {
    path = await osrm(from, to);
    source = 'OSRM demo server, road data © OpenStreetMap contributors (ODbL)';
  } catch {
    path = estimate(from, to);
    source = 'Ước lượng không có mạng: đường cong giữa hai điểm, quãng đường = đường chim bay × 1,3';
  }
  const route = {
    id: `dyn-${key}`,
    name: `${from.name} → ${to.name}${path.estimated ? ' (ước lượng)' : ''}`,
    origin: from,
    destination: to,
    source,
    zones: [],
    ...path,
  };
  if (!path.estimated) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify(route));
  }
  return route;
}
