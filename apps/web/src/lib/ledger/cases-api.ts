import type { components } from "../generated/api";
import { ledgerRequest } from "./request";
import type { LedgerCommandContext } from "./command-context";
type S = components["schemas"];
function post(path: string, body: unknown, cmd: LedgerCommandContext) {
  return ledgerRequest<S["PlatformCaseDetailDto"]>(path, {
    method: "POST",
    headers: { "Idempotency-Key": cmd.idempotencyKey },
    body: JSON.stringify(body),
  });
}
export const api = {
  cases: {
    get: (id: string) =>
      ledgerRequest<S["PlatformCaseDetailDto"]>(
        "/platform-cases/" + encodeURIComponent(id),
      ),
    organizationOptions: () =>
      ledgerRequest<S["CaseOrganizationOptionDto"][]>(
        "/platform-cases/organization-options",
      ),
    create: (v: S["CreateCaseDto"], cmd: LedgerCommandContext) =>
      post("/platform-cases", v, cmd),
    assign: (id: string, v: S["AssignCaseDto"], cmd: LedgerCommandContext) =>
      post("/platform-cases/" + encodeURIComponent(id) + "/assign", v, cmd),
    classify: (
      id: string,
      v: S["ClassifyCaseDto"],
      cmd: LedgerCommandContext,
    ) =>
      post("/platform-cases/" + encodeURIComponent(id) + "/classify", v, cmd),
    linkLot: (id: string, v: S["LinkCaseLotDto"], cmd: LedgerCommandContext) =>
      post("/platform-cases/" + encodeURIComponent(id) + "/link-lot", v, cmd),
    note: (id: string, v: S["CaseNoteDto"], cmd: LedgerCommandContext) =>
      post("/platform-cases/" + encodeURIComponent(id) + "/notes", v, cmd),
    escalate: (
      id: string,
      v: S["EscalateCaseDto"],
      cmd: LedgerCommandContext,
    ) =>
      post("/platform-cases/" + encodeURIComponent(id) + "/escalate", v, cmd),
    close: (id: string, v: S["CloseCaseDto"], cmd: LedgerCommandContext) =>
      post("/platform-cases/" + encodeURIComponent(id) + "/close", v, cmd),
  },
};
