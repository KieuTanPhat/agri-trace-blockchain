import { sensorFigures } from './lot-evidence.js';

describe('Public sensor figures', () => {
  it('summarizes each sensor type and averages per Vietnam calendar day', () => {
    const at = (iso: string) => new Date(iso);
    const r = (sensorType: string, value: number, iso: string, unit = '°C') => ({ sensorType, unit, value, recordedAt: at(iso) });
    const f = sensorFigures([
      r('TEMPERATURE', 20, '2026-11-01T01:00:00Z'),
      r('TEMPERATURE', 24, '2026-11-01T05:00:00Z'),
      // 18:00 UTC is already the next day in Vietnam (UTC+7).
      r('TEMPERATURE', 30, '2026-11-01T18:00:00Z'),
      r('HUMIDITY', 80, '2026-11-01T01:00:00Z', '%'),
    ]);
    expect(f.summary).toEqual([
      { sensorType: 'TEMPERATURE', unit: '°C', min: 20, avg: 24.7, max: 30 },
      { sensorType: 'HUMIDITY', unit: '%', min: 80, avg: 80, max: 80 },
    ]);
    expect(f.daily).toEqual([
      { sensorType: 'TEMPERATURE', day: '2026-11-01', avg: 22 },
      { sensorType: 'TEMPERATURE', day: '2026-11-02', avg: 30 },
      { sensorType: 'HUMIDITY', day: '2026-11-01', avg: 80 },
    ]);
  });
  it('gives nothing for a window without verified readings', () => {
    expect(sensorFigures([])).toEqual({ summary: [], daily: [] });
  });
});
