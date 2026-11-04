import catalog from '../../../apps/api/src/common/locations/weather-points.json' with { type: 'json' };

// Share the API's representative province points; these are route estimates.
export const PROVINCES = catalog.points.map((point) => ({
  code: point.provinceCode,
  name: point.provinceName,
  latitude: point.latitude,
  longitude: point.longitude,
}));
