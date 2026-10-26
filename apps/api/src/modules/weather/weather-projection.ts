import type { CurrentWeatherDto, DailyWeatherDto } from './dto.js';
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const numeric = (value: unknown, min: number, max: number): number | null => {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error('Invalid weather data');
  return value;
};
export const vietnamDate = (time: number) =>
  new Date(time + 7 * 3600000).toISOString().slice(0, 10);
export function projectWeather(
  raw: unknown,
  now: number,
): { current: CurrentWeatherDto; daily: DailyWeatherDto[] } {
  if (
    !object(raw) ||
    raw.timezone !== 'Asia/Ho_Chi_Minh' ||
    raw.utc_offset_seconds !== 25200 ||
    !object(raw.current) ||
    !object(raw.daily) ||
    !object(raw.current_units) ||
    !object(raw.daily_units)
  )
    throw new Error('Invalid weather data');
  const current = raw.current,
    daily = raw.daily;
  for (const [key, unit] of Object.entries({
    time: 'unixtime',
    temperature_2m: '°C',
    relative_humidity_2m: '%',
    wind_speed_10m: 'km/h',
    weather_code: 'wmo code',
  }))
    if (raw.current_units[key] !== unit)
      throw new Error('Unexpected weather unit');
  for (const [key, unit] of Object.entries({
    time: 'unixtime',
    temperature_2m_max: '°C',
    temperature_2m_min: '°C',
    precipitation_probability_max: '%',
    weather_code: 'wmo code',
  }))
    if (raw.daily_units[key] !== unit)
      throw new Error('Unexpected forecast unit');
  if (
    typeof current.time !== 'number' ||
    !Number.isInteger(current.time) ||
    current.time * 1000 > now + 3600000 ||
    current.time * 1000 < now - 3 * 3600000
  )
    throw new Error('Stale weather');
  for (const field of [
    'time',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_probability_max',
    'weather_code',
  ])
    if (!Array.isArray(daily[field]) || daily[field].length !== 3)
      throw new Error('Invalid forecast length');
  const values = daily as Record<string, unknown[]>;
  const days = values.time.map((time, index) => {
    if (
      typeof time !== 'number' ||
      !Number.isInteger(time) ||
      vietnamDate(time * 1000) !== vietnamDate(now + index * 86400000)
    )
      throw new Error('Invalid forecast dates');
    const minimumC = numeric(values.temperature_2m_min[index], -90, 70),
      maximumC = numeric(values.temperature_2m_max[index], -90, 70);
    if (minimumC !== null && maximumC !== null && minimumC > maximumC)
      throw new Error('Invalid temperature range');
    return {
      date: vietnamDate(time * 1000),
      minimumC,
      maximumC,
      precipitationProbabilityPercent: numeric(
        values.precipitation_probability_max[index],
        0,
        100,
      ),
      weatherCode: numeric(values.weather_code[index], 0, 99),
    };
  });
  return {
    current: {
      time: new Date(current.time * 1000).toISOString(),
      temperatureC: numeric(current.temperature_2m, -90, 70),
      humidityPercent: numeric(current.relative_humidity_2m, 0, 100),
      windKmh: numeric(current.wind_speed_10m, 0, 500),
      weatherCode: numeric(current.weather_code, 0, 99),
    },
    daily: days,
  };
}
