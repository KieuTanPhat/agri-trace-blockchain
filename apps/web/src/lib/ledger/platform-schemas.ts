import { z } from "zod";
/** Validation mirrors the baseline command DTOs; identity and versions come from server records. */
export const decision = z.enum(["APPROVE", "REJECT"]);
export const note = (min: number, max: number) =>
  z.string().trim().min(min).max(max);
export const reason = () => note(10, 1000);
