import { z } from "zod";
export const note = (min: number, max: number) =>
  z.string().trim().min(min).max(max);
export const futureDateTime = z
  .string()
  .optional()
  .refine(
    (v) => !v || (Number.isFinite(Date.parse(v)) && Date.parse(v) > Date.now()),
    "Hạn phản hồi phải ở tương lai",
  );
export const localToIso = (v: string | undefined) =>
  v ? new Date(v).toISOString() : undefined;
