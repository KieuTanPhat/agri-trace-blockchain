import locations from './vietnam.json' with { type: 'json' };
import weatherPoints from './weather-points.json' with { type: 'json' };

/**
 * Reuse the versioned representative-place catalog for province estimates.
 * These points are not site addresses or official administrative seats.
 */
const CENTERS = new Map(weatherPoints.points.map((point) => [point.provinceCode, point]));

const normalize = (value: string) =>
  value
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/^(tỉnh|thành phố|tp\.?)\s+/u, '')
    .trim();

const byName = new Map<string, { code: string; name: string }>();
for (const p of (locations as { provinces: { code: string; name: string; label: string }[] }).provinces) {
  byName.set(normalize(p.name), { code: p.code, name: p.name });
  byName.set(normalize(p.label), { code: p.code, name: p.name });
}

/** Representative point of the province in a site's region (label or name). */
export function provinceCenter(region: string | null | undefined) {
  if (!region) return null;
  const p = byName.get(normalize(region));
  const c = p && CENTERS.get(p.code);
  return c ? { code: p.code, name: p.name, latitude: c.latitude, longitude: c.longitude } : null;
}
