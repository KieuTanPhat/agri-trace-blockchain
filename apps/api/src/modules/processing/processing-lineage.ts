import type { Prisma } from '../../generated/prisma/client.js';

type Db = Prisma.TransactionClient;
const MAX_DEPTH = 6;

const lotSummary = (
  lot: {
    id: string;
    lotCode: string;
    unit: string;
    currentState: string;
    originType: string;
    availableQuantity: Prisma.Decimal;
    product: { productName: string };
    organization: { id: string; name: string };
  },
  level: number,
  extra: Record<string, unknown>,
) => ({
  lotId: lot.id,
  lotCode: lot.lotCode,
  productName: lot.product.productName,
  organizationId: lot.organization.id,
  organizationName: lot.organization.name,
  originType: lot.originType,
  currentState: lot.currentState,
  availableQuantity: lot.availableQuantity.toFixed(3),
  unit: lot.unit,
  level,
  ...extra,
});
const LOT_SELECT = {
  id: true,
  lotCode: true,
  unit: true,
  currentState: true,
  originType: true,
  availableQuantity: true,
  product: { select: { productName: true } },
  organization: { select: { id: true, name: true } },
} as const;

/** Finished lots made, directly or through further processing, from the given
 * lots. Used for recall impact: a recalled input reaches every product of it. */
export async function downstreamLots(db: Db, lotIds: string[]) {
  const seen = new Set(lotIds);
  const result: ReturnType<typeof lotSummary>[] = [];
  let frontier = lotIds;
  for (let level = 1; frontier.length && level <= MAX_DEPTH; level++) {
    const inputs = await db.processingInput.findMany({
      where: { lotId: { in: frontier }, run: { status: 'COMPLETED' } },
      include: {
        run: {
          include: {
            outputs: { include: { lot: { select: LOT_SELECT } } },
          },
        },
      },
    });
    const next: string[] = [];
    for (const input of inputs)
      for (const output of input.run.outputs)
        if (output.lot && !seen.has(output.lot.id)) {
          seen.add(output.lot.id);
          next.push(output.lot.id);
          result.push(
            lotSummary(output.lot, level, {
              runCode: input.run.code,
              fromLotId: input.lotId,
              kind: output.kind,
            }),
          );
        }
    frontier = next;
  }
  return result;
}

/** Input lots behind a processed lot, level by level up to the harvests. */
export async function upstreamLots(db: Db, lotId: string) {
  const seen = new Set([lotId]);
  const result: ReturnType<typeof lotSummary>[] = [];
  let frontier = [lotId];
  for (let level = 1; frontier.length && level <= MAX_DEPTH; level++) {
    const lots = await db.lot.findMany({
      where: { id: { in: frontier }, processingRunId: { not: null } },
      select: {
        id: true,
        processingRun: {
          select: {
            code: true,
            inputs: {
              select: { quantity: true, unit: true, lot: { select: LOT_SELECT } },
            },
          },
        },
      },
    });
    const next: string[] = [];
    for (const lot of lots)
      for (const input of lot.processingRun?.inputs ?? [])
        if (!seen.has(input.lot.id)) {
          seen.add(input.lot.id);
          next.push(input.lot.id);
          result.push(
            lotSummary(input.lot, level, {
              runCode: lot.processingRun!.code,
              toLotId: lot.id,
              usedQuantity: input.quantity.toFixed(3),
              usedUnit: input.unit,
            }),
          );
        }
    frontier = next;
  }
  return result;
}
