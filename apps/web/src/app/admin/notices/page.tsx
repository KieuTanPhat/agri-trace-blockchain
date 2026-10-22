"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";

import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { CommandState, DataTable, LoadState, ManagePage, PageHeader, ReasonAction, ReloadButton, Section, StatusBadge } from "@/components/manage";
import { dateTime, label, noticeAudienceLabels, noticeSeverityLabels, type Items, type Row } from "@/lib/platform-admin";

const local = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Maintenance or information banners with a time window and audience. They
 * never open or close writes; the controller write-lock is separate. */
export default function NoticesPage() {
  const state = useWorkspaceData<Items>("/platform-admin/notices");
  const command = useWorkspaceCommand();
  const [form, setForm] = useState({
    title: "",
    body: "",
    audience: "ALL",
    severity: "INFO",
    startsAt: local(new Date()),
    endsAt: local(new Date(Date.now() + 86400000)),
  });
  return (
    <ManagePage>
      <PageHeader title="Thông báo hệ thống" description="Banner hiển thị cho người dùng theo đối tượng và thời gian (tối đa 90 ngày)." actions={<ReloadButton onClick={state.reload} />} />
      <CommandState command={command} />
      <Section title="Đăng thông báo">
        <form
          className="admin-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const done = await command.run("/platform-admin/notices", { ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() });
            if (done !== false) {
              setForm({ ...form, title: "", body: "" });
              state.reload();
            }
          }}
        >
          <label className="field">Tiêu đề<Input className="input" required minLength={3} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className="field">Nội dung<Textarea className="input" required minLength={3} maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
          <label className="field">Đối tượng
            <NativeSelect className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              {Object.entries(noticeAudienceLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </label>
          <label className="field">Mức độ
            <NativeSelect className="input" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {Object.entries(noticeSeverityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </label>
          <label className="field">Bắt đầu<Input className="input" type="datetime-local" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
          <label className="field">Kết thúc<Input className="input" type="datetime-local" required value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label>
          <Button className="button" disabled={command.pending}>Đăng</Button>
        </form>
      </Section>
      <LoadState loading={state.loading} error={state.error} />
      <Section label="Danh sách thông báo">
        <DataTable<Row>
          label="Thông báo hệ thống"
          rows={state.data?.items}
          rowKey={(r) => String(r.id)}
          empty={{ title: "Chưa có thông báo", description: "Đăng thông báo bảo trì hoặc tin tức cho người dùng." }}
          columns={[
            { header: "Tiêu đề", cell: (r) => <><strong>{String(r.title)}</strong><br /><small>{String(r.body)}</small></> },
            { header: "Đối tượng", cell: (r) => label(noticeAudienceLabels, r.audience) },
            { header: "Mức độ", cell: (r) => label(noticeSeverityLabels, r.severity) },
            { header: "Thời gian", cell: (r) => `${dateTime(r.startsAt)} → ${dateTime(r.endsAt)}` },
            { header: "Trạng thái", cell: (r) => <StatusBadge value={r.status === "WITHDRAWN" ? "REVOKED" : r.active ? "ACTIVE" : "INACTIVE"} label={r.status === "WITHDRAWN" ? "Đã thu hồi" : r.active ? "Đang hiển thị" : "Ngoài thời gian"} /> },
            {
              header: "",
              cell: (r) =>
                r.status === "PUBLISHED" ? (
                  <ReasonAction label="Thu hồi" disabled={command.pending} onSubmit={async (reason) => {
                    const done = await command.run(`/platform-admin/notices/${r.id}/withdraw`, { version: r.version, reason });
                    if (done !== false) state.reload();
                    return done;
                  }} />
                ) : null,
            },
          ]}
        />
      </Section>
    </ManagePage>
  );
}
