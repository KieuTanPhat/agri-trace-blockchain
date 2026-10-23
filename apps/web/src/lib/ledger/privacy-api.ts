import type { components } from "../generated/api";
import { ledgerRequest } from "./request";
import type { LedgerCommandContext } from "./command-context";
type S = components["schemas"];
const root = (admin: boolean) =>
  admin ? "/platform-privacy" : "/privacy-requests";
function post(path: string, body: unknown, cmd: LedgerCommandContext) {
  return ledgerRequest<S["PrivacyTicketDto"]>(path, {
    method: "POST",
    headers: {
      "Idempotency-Key": cmd.idempotencyKey,
      ...(cmd.mfaCode?.trim() ? { "X-MFA-Code": cmd.mfaCode.trim() } : {}),
    },
    body: JSON.stringify(body),
  });
}
export const api = {
  privacy: {
    list: (admin: boolean, cursor?: string) =>
      ledgerRequest<S["PrivacyPageDto"]>(
        root(admin) + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      ),
    get: (admin: boolean, id: string) =>
      ledgerRequest<S["PrivacyDetailDto"]>(
        root(admin) + "/" + encodeURIComponent(id),
      ),
    create: (body: S["CreatePrivacyRequestDto"], cmd: LedgerCommandContext) =>
      post(root(false), body, cmd),
    breach: (body: S["CreatePrivacyBreachDto"], cmd: LedgerCommandContext) =>
      post(root(true) + "/breaches", body, cmd),
    review: (
      id: string,
      body: S["UpdatePrivacyTicketDto"],
      cmd: LedgerCommandContext,
    ) => post(root(true) + "/" + encodeURIComponent(id) + "/review", body, cmd),
  },
};
