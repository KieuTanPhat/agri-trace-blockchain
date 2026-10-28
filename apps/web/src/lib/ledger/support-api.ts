import type { components } from "../generated/api";
import { ledgerRequest } from "./request";
import type { LedgerCommandContext } from "./command-context";
type S = components["schemas"];
export type TicketStatus =
  "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
/** Response view follows baseline SupportService.ticketView; AdminListDto has generic item metadata. */
export type Ticket = {
  id: string;
  code: string;
  organizationId: string;
  organizationName: string;
  category: S["TicketCreateInput"]["category"];
  priority: S["TicketCreateInput"]["priority"];
  subject: string;
  status: TicketStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string;
  overdue: boolean;
  resolution: string | null;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  messages: {
    id: string;
    authorSide: string;
    authorName: string | null;
    body: string;
    internal: boolean;
    createdAt: string;
  }[];
};
type Staff = { id: string; fullName: string; email: string; role: string };
const base = "/platform-admin/tickets";
function post(
  id: string,
  action: string,
  body: unknown,
  cmd: LedgerCommandContext,
) {
  return ledgerRequest<S["AdminRecordDto"]>(
    base + "/" + encodeURIComponent(id) + "/" + action,
    {
      method: "POST",
      headers: { "Idempotency-Key": cmd.idempotencyKey },
      body: JSON.stringify(body),
    },
  );
}
export const api = {
  support: {
    tickets: async (status?: string) =>
      (
        await ledgerRequest<{ items: Ticket[] }>(
          base + (status ? "?status=" + encodeURIComponent(status) : ""),
        )
      ).items,
    staff: async () =>
      (await ledgerRequest<{ items: Staff[] }>("/platform-admin/support-staff"))
        .items,
    reply: (
      id: string,
      body: S["TicketReplyInput"],
      cmd: LedgerCommandContext,
    ) => post(id, "reply", body, cmd),
    assign: (
      id: string,
      body: S["TicketAssignInput"],
      cmd: LedgerCommandContext,
    ) => post(id, "assign", body, cmd),
    close: (
      id: string,
      body: S["TicketCloseInput"],
      cmd: LedgerCommandContext,
    ) => post(id, "close", body, cmd),
  },
};
