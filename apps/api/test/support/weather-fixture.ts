export function weatherFixture(now = Date.UTC(2026, 9, 19, 5)) {
  const midnight =
    Math.floor((now + 25200000) / 86400000) * 86400000 - 25200000;
  return {
    timezone: 'Asia/Ho_Chi_Minh',
    utc_offset_seconds: 25200,
    current_units: {
      time: 'unixtime',
      temperature_2m: '°C',
      relative_humidity_2m: '%',
      wind_speed_10m: 'km/h',
      weather_code: 'wmo code',
    },
    current: {
      time: Math.floor(now / 1000),
      temperature_2m: 27.5,
      relative_humidity_2m: 80,
      wind_speed_10m: 6.5,
      weather_code: 3,
    },
    daily_units: {
      time: 'unixtime',
      temperature_2m_max: '°C',
      temperature_2m_min: '°C',
      precipitation_probability_max: '%',
      weather_code: 'wmo code',
    },
    daily: {
      time: [0, 1, 2].map((i) => (midnight + i * 86400000) / 1000),
      temperature_2m_max: [30, 31, 32],
      temperature_2m_min: [24, 25, 26],
      precipitation_probability_max: [40, 50, 60],
      weather_code: [3, 61, 95],
    },
  };
}
