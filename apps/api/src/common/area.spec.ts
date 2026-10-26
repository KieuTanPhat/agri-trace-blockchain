import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { areaInM2, assertCultivatedArea } from './area.js';

const d = (v: number) => new Prisma.Decimal(v);

describe('areaInM2', () => {
  it('converts the supported units and ignores legacy free text', () => {
    expect(areaInM2(d(500), 'm2')).toBe(500);
    expect(areaInM2(d(500), 'm²')).toBe(500);
    expect(areaInM2(d(1.5), 'ha')).toBe(15_000);
    expect(areaInM2(d(2), null)).toBe(2);
    expect(areaInM2(d(3), 'sào')).toBeNull();
    expect(areaInM2(null, 'ha')).toBeNull();
  });
});

describe('assertCultivatedArea', () => {
  const farm = { areaM2: d(20_000) };
  it('bounds the cycle by its plot, then by its farm', () => {
    expect(() => assertCultivatedArea(1_000, { area: d(0.1), unit: 'ha' }, farm)).not.toThrow();
    expect(() => assertCultivatedArea(1_001, { area: d(0.1), unit: 'ha' }, farm)).toThrow(/thửa đất/);
    expect(() => assertCultivatedArea(20_001, null, farm)).toThrow(/vùng sản xuất/);
  });
  it('enforces nothing it cannot measure', () => {
    expect(() => assertCultivatedArea(undefined, { area: d(1), unit: 'm2' }, farm)).not.toThrow();
    expect(() => assertCultivatedArea(5_000, { area: d(1), unit: 'sào' }, { areaM2: null })).not.toThrow();
  });
});
