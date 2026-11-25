import { UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

/** Units a plot area may be recorded in, with their size in square metres. */
export const AREA_UNITS = { m2: 1, ha: 10_000 } as const;
type AreaUnit = keyof typeof AREA_UNITS;

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

/** Cycles that still hold their plot area; a completed or cancelled cycle
 * gives its area back to the plot. */
export const AREA_HOLDING_STATES = ['CREATED', 'PLANTED', 'GROWING'] as const;

type AreaDb = Pick<Prisma.TransactionClient, 'productionCycle'>;

/** m² held by running cycles, per plot. */
export async function reservedPlotAreas(db: AreaDb, plotIds: string[]) {
  if (!plotIds.length) return new Map<string, number>();
  const rows = await db.productionCycle.groupBy({
    by: ['plotId'],
    where: { plotId: { in: plotIds }, currentState: { in: [...AREA_HOLDING_STATES] } },
    _sum: { cultivatedArea: true },
  });
  return new Map(rows.map((r) => [r.plotId as string, Number(r._sum.cultivatedArea ?? 0)]));
}

/** A new cycle only takes the plot area not held by other running cycles.
 * Serialized per plot so two concurrent cycles cannot both take the rest. */
export async function assertPlotAreaFree(
  tx: Prisma.TransactionClient,
  plot: { id: string; area: Prisma.Decimal | null; unit: string | null } | null,
  cultivatedArea: number | null | undefined,
) {
  if (!plot || cultivatedArea === null || cultivatedArea === undefined) return;
  const plotM2 = areaInM2(plot.area, plot.unit);
  if (plotM2 === null) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plot-area:${plot.id}`}, 0))`;
  const held = (await reservedPlotAreas(tx, [plot.id])).get(plot.id) ?? 0;
  if (held + cultivatedArea > plotM2)
    throw new UnprocessableEntityException(
      `Thửa chỉ còn trống ${Math.max(0, plotM2 - held)} m² (các vụ đang chạy đã dùng ${held}/${plotM2} m²); diện tích được trả lại khi vụ kết thúc hoặc bị hủy`,
    );
}
