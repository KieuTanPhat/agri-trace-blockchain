import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { areaInM2, assertCultivatedArea, assertPlotAreaFree } from './area.js';

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

describe('assertPlotAreaFree', () => {
  const tx = (held: number | null) =>
    ({
      $executeRaw: vi.fn().mockResolvedValue(0),
      productionCycle: {
        groupBy: vi.fn().mockResolvedValue(held === null ? [] : [{ plotId: 'p', _sum: { cultivatedArea: d(held) } }]),
      },
    }) as never;
  const plot = { id: 'p', area: d(9_900), unit: 'm2' };
  it('lets a cycle take only the area running cycles leave free', async () => {
    await expect(assertPlotAreaFree(tx(6_000), plot, 3_900)).resolves.toBeUndefined();
    await expect(assertPlotAreaFree(tx(6_000), plot, 3_901)).rejects.toThrow(/còn trống 3900 m²/);
    await expect(assertPlotAreaFree(tx(null), plot, 9_900)).resolves.toBeUndefined();
  });
  it('counts only running cycles and locks the plot', async () => {
    const t = tx(0) as unknown as { $executeRaw: ReturnType<typeof vi.fn>; productionCycle: { groupBy: ReturnType<typeof vi.fn> } };
    await assertPlotAreaFree(t as never, plot, 100);
    expect(t.$executeRaw).toHaveBeenCalled();
    expect(t.productionCycle.groupBy.mock.calls[0][0].where.currentState).toEqual({ in: ['CREATED', 'PLANTED', 'GROWING'] });
  });
  it('enforces nothing without an area or a measurable plot', async () => {
    await expect(assertPlotAreaFree(tx(9_900), plot, undefined)).resolves.toBeUndefined();
    await expect(assertPlotAreaFree(tx(9_900), { id: 'p', area: d(1), unit: 'sào' }, 5_000)).resolves.toBeUndefined();
  });
});
