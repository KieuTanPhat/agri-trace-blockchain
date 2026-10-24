import { z } from "zod";
import type { components } from "../generated/api";
import { reason } from "./platform-schemas";
const uuid = z.uuid(),
  version = z.coerce.number().int().min(0),
  text = z.string().trim().min(1).max(1000);
const base = { reason: reason() };
export const temporaryPasswordSchema = z.string().refine((p) => {
  const bytes = new TextEncoder().encode(p).length;
  return bytes >= 12 && bytes <= 72;
}, "Mật khẩu tạm phải từ 12 đến 72 byte UTF-8");
const inputs = z.discriminatedUnion("operation", [
  z.object({
    ...base,
    operation: z.literal("CAPABILITY_GRANT"),
    organizationId: uuid,
    code: z.enum([
      "FARM",
      "TRANSPORTER",
      "PROCESSOR",
      "DISTRIBUTOR",
      "RETAILER",
      "AUDITOR",
    ]),
  }),
  z.object({
    ...base,
    operation: z.literal("CREATE_CHAIN_GRANT"),
    organizationId: uuid,
    userId: uuid,
  }),
  z.object({
    ...base,
    operation: z.literal("SYSTEM_ADMIN_CREATE"),
    email: z.email().max(255),
    fullName: text.max(255),
    roleCode: z.enum([
      "SYSTEM_ADMIN",
      "PLATFORM_OPERATOR",
      "PLATFORM_CASE_MANAGER",
      "PLATFORM_PRIVACY_OFFICER",
    ]),
  }),
  z.object({
    ...base,
    operation: z.literal("ADMIN_PASSWORD_RESET"),
    userId: uuid,
    temporaryPassword: temporaryPasswordSchema,
  }),
  z.object({
    ...base,
    operation: z.literal("CONNECTION_APPROVE"),
    connectionId: uuid,
    version,
    note: text.min(10),
  }),
  z.object({
    ...base,
    operation: z.literal("CAPABILITY_REQUEST_APPROVE"),
    requestId: uuid,
    version,
    note: text,
  }),
  z.object({
    ...base,
    operation: z.literal("PLAN_VERSION_PUBLISH"),
    versionId: uuid,
  }),
  z.object({
    ...base,
    operation: z.literal("INVOICE_CONFIRM_PAYMENT"),
    invoiceId: uuid,
    version,
    reference: text.max(120),
  }),
  z.object({
    ...base,
    operation: z.literal("SETTING_CHANGE"),
    key: text.max(80),
    version,
    value: z.string().transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Nhập giá trị JSON hợp lệ" });
        return z.NEVER;
      }
    }),
  }),
  z.object({
    ...base,
    operation: z.literal("QR_BLOCK"),
    lotId: uuid,
    publicMessage: text.max(500),
  }),
]);
export function parseApprovalProposal(
  values: unknown,
): components["schemas"]["ProposeApprovalDto"] {
  const { operation, reason, ...params } = inputs.parse(values);
  return { operation, reason, params };
}
export const approvalFormSchema = z
  .object({
    operation: z.enum([
      "CAPABILITY_GRANT",
      "CREATE_CHAIN_GRANT",
      "SYSTEM_ADMIN_CREATE",
      "CONNECTION_APPROVE",
      "ADMIN_PASSWORD_RESET",
      "CAPABILITY_REQUEST_APPROVE",
      "PLAN_VERSION_PUBLISH",
      "INVOICE_CONFIRM_PAYMENT",
      "SETTING_CHANGE",
      "QR_BLOCK",
    ]),
    email: z.string().optional(),
    fullName: z.string().optional(),
    roleCode: z.string().optional(),
    userId: z.string().optional(),
    organizationId: z.string().optional(),
    temporaryPassword: z.string().optional(),
    code: z.string().optional(),
    connectionId: z.string().optional(),
    requestId: z.string().optional(),
    versionId: z.string().optional(),
    invoiceId: z.string().optional(),
    lotId: z.string().optional(),
    version: z.union([z.string(), z.number()]).optional(),
    note: z.string().optional(),
    reference: z.string().optional(),
    key: z.string().optional(),
    value: z.string().optional(),
    publicMessage: z.string().optional(),
    reason: reason(),
  })
  .superRefine((v, ctx) => {
    const r = inputs.safeParse(v);
    if (!r.success)
      for (const issue of r.error.issues)
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
  });
