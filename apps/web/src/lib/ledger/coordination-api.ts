import type { components } from "../generated/api";
import { ledgerRequest } from "./request";
import type { LedgerCommandContext } from "./command-context";
type S = components["schemas"];
export type ReportStatus = "NEW" | "ESCALATED" | "DISMISSED" | "DUPLICATE";
/** Baseline SupportService response views; generated AdminListDto uses generic item metadata. */
export type ConsumerReport = {
  id: string;
  lotId: string;
  lotCode: string | null;
  productName: string | null;
  organizationName: string | null;
  category: S["ConsumerReportInput"]["category"];
  description: string;
  contactEmail: string | null;
  contactPhone: string | null;
  hasContact: boolean;
  status: ReportStatus;
  triageNote: string | null;
  triagedAt: string | null;
  caseId: string | null;
  version: number;
  createdAt: string;
  sameSourceReports: number;
};
export type Notice = S["NoticeInput"] & {
  id: string;
  status: "PUBLISHED" | "WITHDRAWN";
  active: boolean;
  version: number;
  createdAt: string;
  createdBy: string;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
};
function post(path: string, body: unknown, cmd: LedgerCommandContext) {
  return ledgerRequest<{ record: { id: string; caseId?: string | null } }>(
    path,
    {
      method: "POST",
      headers: { "Idempotency-Key": cmd.idempotencyKey },
      body: JSON.stringify(body),
    },
  );
}
export const api = {
  support: {
    reports: async (status?: string) =>
      (
        await ledgerRequest<{ items: ConsumerReport[] }>(
          "/platform-admin/consumer-reports" +
            (status ? "?status=" + encodeURIComponent(status) : ""),
        )
      ).items,
    triage: (
      id: string,
      body: S["ReportTriageInput"],
      cmd: LedgerCommandContext,
    ) =>
      post(
        "/platform-admin/consumer-reports/" +
          encodeURIComponent(id) +
          "/triage",
        body,
        cmd,
      ),
  },
  trace: {
    recall: (id: string) =>
      ledgerRequest<S["RecallPreviewDto"]>(
        "/platform-recall/" + encodeURIComponent(id),
      ),
  },
  config: {
    notices: async () =>
      (await ledgerRequest<{ items: Notice[] }>("/platform-admin/notices"))
        .items,
    publishNotice: (body: S["NoticeInput"], cmd: LedgerCommandContext) =>
      post("/platform-admin/notices", body, cmd),
    withdrawNotice: (
      id: string,
      body: S["VersionReasonInput"],
      cmd: LedgerCommandContext,
    ) =>
      post(
        "/platform-admin/notices/" + encodeURIComponent(id) + "/withdraw",
        body,
        cmd,
      ),
  },
};
