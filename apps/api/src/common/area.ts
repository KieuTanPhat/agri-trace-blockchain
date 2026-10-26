import { UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

/** Units a plot area may be recorded in, with their size in square metres. */
export const AREA_UNITS = { m2: 1, ha: 10_000 } as const;
export type AreaUnit = keyof typeof AREA_UNITS;

/** Area in m², or null when the unit is a legacy free-text value. */
export function areaInM2(
  area: Prisma.Decimal | number | null | undefined,
  unit: string | null | undefined,
): number | null {
  if (area === null || area === undefined) return null;
  const key = (unit ?? 'm2').trim().toLowerCase().replace('²', '2');
  const factor = AREA_UNITS[key as AreaUnit];
  return factor ? Number(area) * factor : null;
}

/** A cycle cannot cultivate more land than its plot, or than its farm when it
 * names no plot. Bounds recorded in an unknown unit are not enforced. */
export function assertCultivatedArea(
  cultivatedArea: number | null | undefined,
  plot: { area: Prisma.Decimal | null; unit: string | null } | null,
  farm: { areaM2: Prisma.Decimal | null },
) {
  if (cultivatedArea === null || cultivatedArea === undefined) return;
  const plotM2 = plot ? areaInM2(plot.area, plot.unit) : null;
  if (plotM2 !== null && cultivatedArea > plotM2)
    throw new UnprocessableEntityException(
      `Diện tích canh tác vượt diện tích thửa đất (${plotM2} m²)`,
    );
  const farmM2 = farm.areaM2 === null ? null : Number(farm.areaM2);
  if (farmM2 !== null && cultivatedArea > farmM2)
    throw new UnprocessableEntityException(
      `Diện tích canh tác vượt diện tích vùng sản xuất (${farmM2} m²)`,
    );
}
