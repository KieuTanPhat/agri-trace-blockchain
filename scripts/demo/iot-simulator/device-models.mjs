// Physical models for virtual devices (ADR-006). Pure functions: given a seed
// and an instant they return what a real sensor or GPS receiver would report.

const RAD = Math.PI / 180;
export function distanceMeters(a, b) {
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function bearing(a, b) {
  const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD);
  const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

/** Deterministic PRNG so backfilled history is reproducible per device. */
export function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (Math.imul(31, s) + ch.charCodeAt(0)) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Smooth value noise in [-1, 1] keyed by an integer step. */
function noise(seed, step) {
  const at = (i) => rng(`${seed}:${i}`)() * 2 - 1;
  const i = Math.floor(step);
  const f = step - i;
  const u = f * f * (3 - 2 * f);
  return at(i) * (1 - u) + at(i + 1) * u;
}

const VN_OFFSET_H = 7;
/**
 * Field climate at a plot. Temperature follows the day (minimum around 5:00,
 * maximum around 14:00), humidity runs opposite to it, soil moisture dries with
 * heat and jumps after irrigation or rain.
 */
export function fieldClimate(seed, at, state) {
  const hour = ((at.getTime() / 3_600_000 + VN_OFFSET_H) % 24 + 24) % 24;
  const day = at.getTime() / 86_400_000;
  const diurnal = Math.sin(((hour - 8) / 24) * 2 * Math.PI);
  const dayShift = noise(`${seed}:day`, day / 2) * 2.5;
  const temperature = Math.min(60, Math.max(-10,
    25 + dayShift + 5.5 * diurnal + noise(`${seed}:t`, at.getTime() / 900_000) * 0.6 + (state.temperatureAdjustment ?? 0),
  ));
  const baseHumidity = Math.min(98, Math.max(38,
    82 - 2.4 * (temperature - 25) + noise(`${seed}:h`, at.getTime() / 1_200_000) * 3,
  ));
  const humidity = Math.min(100, Math.max(0, baseHumidity + (state.humidityAdjustment ?? 0)));
  return {
    TEMPERATURE: { value: +temperature.toFixed(2), unit: '°C' },
    HUMIDITY: { value: +humidity.toFixed(2), unit: '%' },
    SOIL_MOISTURE: { value: +state.soil.toFixed(2), unit: '%' },
  };
}
/** Advances soil moisture by `minutes`; returns the new value. */
export function drySoil(seed, soil, at, minutes, drought) {
  const hour = ((at.getTime() / 3_600_000 + VN_OFFSET_H) % 24 + 24) % 24;
  const heat = hour >= 9 && hour <= 17 ? 1.6 : 0.6;
  let next = soil - (minutes / 60) * 0.12 * heat * (drought ? 6 : 1);
  // Scheduled drip irrigation at 6:00 every second day keeps a realistic sawtooth.
  const dayIndex = Math.floor((at.getTime() / 3_600_000 + VN_OFFSET_H) / 24);
  if (!drought && dayIndex % 2 === 0 && hour >= 6 && hour < 6 + minutes / 60) next += 18;
  // Occasional afternoon showers.
  if (!drought && hour >= 15 && hour < 15 + minutes / 60 && rng(`${seed}:rain:${dayIndex}`)() < 0.25) next += 10;
  return Math.min(62, Math.max(12, next));
}

export function inBox(p, box) {
  return p[0] >= box.minLat && p[0] <= box.maxLat && p[1] >= box.minLng && p[1] <= box.maxLng;
}

/** Cumulative distances along a polyline for interpolation. */
export function prepareRoute(route) {
  const cum = [0];
  for (let i = 1; i < route.coordinates.length; i++) cum.push(cum[i - 1] + distanceMeters(route.coordinates[i - 1], route.coordinates[i]));
  return { ...route, cum, length: cum.at(-1) };
}
export function pointAt(route, meters) {
  const m = Math.max(0, Math.min(route.length, meters));
  let lo = 0;
  let hi = route.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (route.cum[mid] <= m) lo = mid;
    else hi = mid;
  }
  const a = route.coordinates[lo];
  const b = route.coordinates[hi];
  const seg = route.cum[hi] - route.cum[lo] || 1;
  const f = (m - route.cum[lo]) / seg;
  return { position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading: bearing(a, b) };
}

/**
 * Target speed at a point of the route: slow in towns near both ends, slower on
 * the mountain pass, faster on the open road, with traffic noise.
 */
export function targetSpeed(route, meters, position, seed, at) {
  const fromEnd = Math.min(meters, route.length - meters);
  const pass = (route.zones ?? []).find((z) => z.kind === 'PASS' && inBox(position, z.box));
  let base = fromEnd < 6000 ? 28 : route.length < 40_000 ? 32 : 62;
  if (pass) base = Math.min(base, pass.maxKmh);
  const hour = ((at.getTime() / 3_600_000 + VN_OFFSET_H) % 24 + 24) % 24;
  const rush = (hour >= 7 && hour < 9) || (hour >= 16.5 && hour < 19) ? 0.6 : 1;
  const traffic = 1 + noise(`${seed}:traffic`, meters / 1500) * 0.25;
  return Math.max(4, base * rush * traffic);
}

/** GPS receiver error: a few metres normally, occasionally a multipath spike. */
export function gpsError(seed, sequence, urban) {
  const r = rng(`${seed}:gps:${sequence}`);
  const spike = r() < (urban ? 0.03 : 0.01);
  const sigma = spike ? 35 : urban ? 7 : 4;
  const angle = r() * 2 * Math.PI;
  const dist = Math.abs(r() + r() + r() - 1.5) * sigma;
  const dLat = (dist * Math.cos(angle)) / 111_320;
  const dLng = (dist * Math.sin(angle)) / (111_320 * Math.cos(10.8 * RAD));
  return { dLat, dLng, accuracy: +(sigma * (0.8 + r() * 0.6)).toFixed(1), satellites: Math.round(spike ? 5 + r() * 2 : 8 + r() * 5) };
}
