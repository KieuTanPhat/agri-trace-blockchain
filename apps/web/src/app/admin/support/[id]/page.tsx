"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { CommandState, DetailList, LoadState, ManagePage, PageHeader, ReasonAction, ReloadButton, Section } from "@/components/manage";
import { dateTime, label, priorityLabels, ticketCategoryLabels, ticketStatusLabels, type Items, type Row } from "@/lib/platform-admin";

/** One support request: assign, reply (public or internal note) and close. */
export default function SupportTicketPage() {
  const { id } = useParams<{ id: string }>();
  const state = useWorkspaceData<Items>("/platform-admin/tickets");
  const staff = useWorkspaceData<Items>("/platform-admin/support-staff");
  const command = useWorkspaceCommand();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [next, setNext] = useState("WAITING_CUSTOMER");
  const [assignee, setAssignee] = useState("");
  const ticket = state.data?.items.find((t) => t.id === id);
  const messages = (ticket?.messages as Row[] | undefined) ?? [];
  const done = (ok: unknown) => {
    if (ok !== false) state.reload();
    return ok;
  };
  return (
    <ManagePage>
      <PageHeader back="/admin/support" title={ticket ? `${ticket.code}: ${ticket.subject}` : "Yêu cầu hỗ trợ"} actions={<ReloadButton onClick={state.reload} />} />
      <LoadState loading={state.loading} error={state.error} />
      <CommandState command={command} />
      {ticket && (
        <>
          <Section title="Thông tin">
            <DetailList
              items={[
                ["Doanh nghiệp", String(ticket.organizationName)],
                ["Loại", label(ticketCategoryLabels, ticket.category)],
                ["Ưu tiên", label(priorityLabels, ticket.priority)],
                ["Trạng thái", label(ticketStatusLabels, ticket.status)],
                ["Phụ trách", String(ticket.assigneeName ?? "Chưa giao")],
                ["Hạn phản hồi", dateTime(ticket.dueAt)],
              ]}
            />
            {ticket.status !== "CLOSED" && (
              <div className="admin-inline-form">
                <label className="field">
                  Giao cho
                  <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">Chọn nhân sự</option>
                    {staff.data?.items.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.fullName)} ({String(s.role)})</option>)}
                  </select>
                </label>
                <button type="button" className="button secondary" disabled={!assignee || command.pending} onClick={async () => done(await command.run(`/platform-admin/tickets/${id}/assign`, { assigneeId: assignee, version: ticket.version }))}>
                  Giao việc
                </button>
                <ReasonAction label="Đóng yêu cầu" disabled={command.pending} placeholder="Kết quả xử lý (tối thiểu 10 ký tự)" onSubmit={async (reason) => done(await command.run(`/platform-admin/tickets/${id}/close`, { version: ticket.version, reason }))} />
              </div>
            )}
          </Section>
          <Section title="Trao đổi">
            <ul className="manage-thread">
              {messages.map((m) => (
                <li key={String(m.id)} className={m.internal ? "notice" : undefined}>
                  <strong>{m.authorSide === "PLATFORM" ? `AgriTrace · ${m.authorName ?? ""}` : String(m.authorName ?? "Doanh nghiệp")}</strong>
                  {m.internal ? " · Ghi chú nội bộ" : ""} · <small>{dateTime(m.createdAt)}</small>
                  <p>{String(m.body)}</p>
                </li>
              ))}
            </ul>
            {ticket.status !== "CLOSED" && (
              <form
                className="admin-reason"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (done(await command.run(`/platform-admin/tickets/${id}/reply`, { body: body.trim(), internal, status: internal ? undefined : next, version: ticket.version })) !== false) setBody("");
                }}
              >
                <textarea className="input" aria-label="Nội dung trả lời" required minLength={2} value={body} onChange={(e) => setBody(e.target.value)} />
                <label><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Ghi chú nội bộ (doanh nghiệp không thấy)</label>
                {!internal && (
                  <label className="field">
                    Trạng thái sau khi trả lời
                    <select className="input" value={next} onChange={(e) => setNext(e.target.value)}>
                      <option value="WAITING_CUSTOMER">Chờ doanh nghiệp</option>
                      <option value="IN_PROGRESS">Đang xử lý</option>
                      <option value="RESOLVED">Đã giải quyết</option>
                    </select>
                  </label>
                )}
                <button className="button" disabled={command.pending}>Gửi</button>
              </form>
            )}
          </Section>
        </>
      )}
    </ManagePage>
  );
}
