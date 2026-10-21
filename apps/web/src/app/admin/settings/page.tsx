"use client";

import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { CommandState, DataTable, LoadState, ManagePage, PageHeader, ReasonAction, ReloadButton, Section } from "@/components/manage";
import { dateTime, type Items, type Row } from "@/lib/platform-admin";

type Setting = Row & { key: string; value: unknown; description: string; version: number; editable: boolean; hint: string | null };

function parse(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return JSON.parse(trimmed);
}

/** Non-secret business parameters, versioned and audited. Changing one needs
 * a second administrator when two-person approval is enforced. Secrets, keys
 * and ledger/controller configuration are never edited here. */
export default function SettingsPage() {
  const state = useWorkspaceData<Items<Setting>>("/platform-admin/settings");
  const command = useWorkspaceCommand();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState("");
  const groups = [
    { title: "Dịch vụ & thanh toán", prefix: "billing." },
    { title: "Chế biến", prefix: "processing." },
    { title: "Xét duyệt & hỗ trợ", prefix: "enrollment." },
    { title: "Hỗ trợ & báo cáo", prefix: "support.|consumerReports." },
    { title: "Cấu hình thông báo", prefix: "notifications." },
  ];
  const rows = state.data?.items ?? [];
  return (
    <ManagePage>
      <PageHeader
        title="Cấu hình nền tảng & thông báo"
        description="Chỉ tham số nghiệp vụ không nhạy cảm, có phiên bản và nhật ký. Khóa bí mật, cấu hình Fabric và controller không chỉnh từ trình duyệt."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <LoadState loading={state.loading} error={state.error} />
      <CommandState command={command} />
      {parseError && <p className="notice error">{parseError}</p>}
      {groups.map((group) => {
        const items = rows.filter((r) => group.prefix.split("|").some((p) => r.key.startsWith(p)));
        if (!items.length) return null;
        return (
          <Section key={group.title} title={group.title}>
            <DataTable<Setting>
              label={group.title}
              rows={items}
              rowKey={(r) => r.key}
              columns={[
                { header: "Tham số", cell: (r) => <><strong>{r.description}</strong><br /><small>{r.key}</small></> },
                { header: "Giá trị hiện tại", cell: (r) => <code>{JSON.stringify(r.value)}</code> },
                { header: "Cập nhật", cell: (r) => `v${r.version} · ${dateTime(r.updatedAt)}` },
                {
                  header: "Đổi giá trị",
                  cell: (r) =>
                    r.editable ? (
                      <ReasonAction
                        label="Đổi"
                        disabled={command.pending}
                        extra={
                          <input
                            className="input"
                            aria-label={`Giá trị mới cho ${r.key}`}
                            placeholder={r.hint ?? "Giá trị mới"}
                            value={drafts[r.key] ?? JSON.stringify(r.value)}
                            onChange={(e) => setDrafts({ ...drafts, [r.key]: e.target.value })}
                          />
                        }
                        onSubmit={async (reason) => {
                          setParseError("");
                          let value: unknown;
                          try {
                            value = parse(drafts[r.key] ?? JSON.stringify(r.value));
                          } catch {
                            setParseError("Giá trị không phải JSON hợp lệ");
                            return false;
                          }
                          const done = await command.run(`/platform-admin/settings/${encodeURIComponent(r.key)}`, { value, version: r.version, reason });
                          if (done !== false) state.reload();
                          return done;
                        }}
                      />
                    ) : (
                      "Chỉ đọc"
                    ),
                },
              ]}
            />
          </Section>
        );
      })}
    </ManagePage>
  );
}
