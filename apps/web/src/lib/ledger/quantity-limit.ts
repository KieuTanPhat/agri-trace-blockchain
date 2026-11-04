import type { z } from "zod";
import { fmtNumber } from "./format";
import { t as tr } from "./i18n";

type Max = string | number | null | undefined;
export type QuantityLimit = {
  path: (string | number)[];
  value: unknown;
  max: Max;
  unit?: string;
};

const known = (max: Max): max is string | number =>
  max !== null && max !== undefined && max !== "";

/** Chặn số lượng vượt lượng khả dụng ngay trên form; máy chủ vẫn kiểm lại. */
export function checkQuantityLimits(
  ctx: z.RefinementCtx,
  limits: QuantityLimit[],
) {
  for (const limit of limits) {
    if (!known(limit.max)) continue;
    const value = Number(limit.value);
    if (!Number.isFinite(value) || value <= Number(limit.max)) continue;
    ctx.addIssue({
      code: "custom",
      path: limit.path,
      message: tr("Vượt khả dụng (tối đa {p0})", {
        p0: `${fmtNumber(limit.max)}${limit.unit ? ` ${limit.unit}` : ""}`,
      }),
    });
  }
}

/** Gợi ý dưới ô số lượng, giữ chỗ cố định nên lỗi không đẩy form. */
export const maxQuantityHint = (max: Max, unit?: string) =>
  known(max)
    ? tr("Tối đa {p0}", { p0: `${fmtNumber(max)}${unit ? ` ${unit}` : ""}` })
    : undefined;
