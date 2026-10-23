import { ConflictException } from '@nestjs/common';

/** Include for code that needs a lot's chain scope. Harvest lots resolve it
 * through their production cycle; processed lots through their run. */
export const LOT_ORIGIN_INCLUDE = {
  harvest: { include: { cycle: true } },
  processingRun: true,
} as const;

type OriginLike = {
  harvest?: { cycle: { chainId: string | null } } | null;
  processingRun?: { chainId: string; siteId: string } | null;
};

export function lotChainId(lot: OriginLike): string | undefined {
  return lot.harvest?.cycle.chainId ?? lot.processingRun?.chainId ?? undefined;
}

/** Flows bound to a production cycle (legacy shipments, shipment plans, cycle
 * certificates) do not accept lots created by processing. */
export function harvestOf<H>(lot: { harvest: H | null }): H {
  if (!lot.harvest)
    throw new ConflictException(
      'Lô thành phẩm từ chế biến không dùng chức năng gắn với vụ thu hoạch',
    );
  return lot.harvest;
}

/** Site that answers for a lot's origin: the farm of its cycle or the
 * processing site of its run. */
export function lotSiteId(lot: OriginLike & {
  harvest?: { cycle: { chainId: string | null; farmId: string } } | null;
}): string | undefined {
  return lot.harvest?.cycle.farmId ?? lot.processingRun?.siteId ?? undefined;
}
