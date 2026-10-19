"use client";

import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { CommandState, LoadState, ManagePage, PageHeader, ReloadButton, Section, StatusBadge } from "@/components/manage";
import { dateTime, label, priorityLabels, ticketCategoryLabels, ticketStatusLabels, type Items, type Row } from "@/lib/platform-admin";

/** Support requests to AgriTrace and their conversation. */
export default function EnterpriseSupportPage() {
  const state = useWorkspaceData<Items>("/enterprise-support/tickets");
  const command = useWorkspaceCommand();
  const [form, setForm] = useState({ category: "TECHNICAL", priority: "NORMAL", subject: "", body: "" });
  const [replies, setReplies] = useState<Record<string, string>>({});
  return (
    <ManagePage>
      <PageHeader title="Hỗ trợ từ AgriTrace" description="Gửi yêu cầu về tài khoản, thanh toán, truy xuất, blockchain hoặc chế biến. Nhân sự nền tảng phản hồi theo mức ưu tiên." actions={<ReloadButton onClick={state.reload} />} />
      <CommandState command={command} />
      <Section title="Gửi yêu cầu mới">
        <form
          className="admin-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if ((await command.run("/enterprise-support/tickets", form)) !== false) {
              setForm({ ...form, subject: "", body: "" });
              state.reload();
            }
          }}
        >
          <label className="field">Loại
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(ticketCategoryLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">Ưu tiên
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {Object.entries(priorityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">Chủ đề<input className="input" required minLength={5} maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
          <label className="field">Nội dung<textarea className="input" required minLength={10} maxLength={4000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
          <button className="button" disabled={command.pending}>Gửi yêu cầu</button>
        </form>
      </Section>
      <LoadState loading={state.loading} error={state.error} />
      {state.data?.items.map((t) => (
        <Section
          key={String(t.id)}
          title={`${t.code} · ${t.subject}`}
          help={`${label(ticketCategoryLabels, t.category)} · Ưu tiên ${label(priorityLabels, t.priority)} · Tạo ${dateTime(t.createdAt)}`}
          actions={<StatusBadge value={t.status === "CLOSED" ? "INACTIVE" : t.status === "RESOLVED" ? "ACTIVE" : "PENDING_REVIEW"} label={label(ticketStatusLabels, t.status)} />}
        >
          <ul className="manage-thread">
            {(t.messages as Row[]).map((m) => (
              <li key={String(m.id)}>
                <strong>{m.authorSide === "PLATFORM" ? "AgriTrace" : String(m.authorName ?? "Doanh nghiệp")}</strong> · <small>{dateTime(m.createdAt)}</small>
                <p>{String(m.body)}</p>
              </li>
            ))}
          </ul>
          {t.status !== "CLOSED" && (
            <form
              className="admin-inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if ((await command.run(`/enterprise-support/tickets/${t.id}/reply`, { body: (replies[String(t.id)] ?? "").trim(), version: t.version })) !== false) {
                  setReplies({ ...replies, [String(t.id)]: "" });
                  state.reload();
                }
              }}
            >
              <label className="field">Trả lời<input className="input" required minLength={2} value={replies[String(t.id)] ?? ""} onChange={(e) => setReplies({ ...replies, [String(t.id)]: e.target.value })} /></label>
              <button className="button secondary" disabled={command.pending}>Gửi</button>
            </form>
          )}
        </Section>
      ))}
    </ManagePage>
  );
}
