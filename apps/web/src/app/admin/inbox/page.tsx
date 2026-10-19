"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspaceData } from "@/lib/workspace";
import {
  DataTable,
  LoadState,
  ManagePage,
  PageHeader,
  ReloadButton,
  Section,
  StatusBadge,
  Tabs,
} from "@/components/manage";
import { dateTime, inboxKindLabels, label, type RecordOf, type Row } from "@/lib/platform-admin";

type Inbox = { items: Row[]; summary: Record<string, number> };

/** One queue for everything waiting on a platform decision; overdue first. */
export default function AdminInboxPage() {
  const state = useWorkspaceData<RecordOf<Inbox>>("/platform-admin/inbox");
  const [kind, setKind] = useState("ALL");
  const inbox = state.data?.record;
  const rows = (inbox?.items ?? []).filter((r) => kind === "ALL" || r.kind === kind);
  return (
    <ManagePage>
      <PageHeader
        title="Hồ sơ chờ xử lý"
        description="Gom mọi việc chờ quyết định của nền tảng, sắp việc quá hạn lên đầu. Thời hạn xử lý lấy theo cấu hình nền tảng."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <LoadState loading={state.loading} error={state.error} />
      {inbox && (
        <Section label="Hàng đợi">
          <Tabs
            value={kind}
            onChange={setKind}
            tabs={[
              { value: "ALL", label: "Tất cả", count: inbox.summary.total },
              ...Object.keys(inboxKindLabels)
                .filter((k) => inbox.summary[k])
                .map((k) => ({ value: k, label: label(inboxKindLabels, k), count: inbox.summary[k] })),
            ]}
          />
          <DataTable
            label="Việc chờ xử lý"
            rows={rows}
            rowKey={(r) => `${r.kind}-${r.id}`}
            empty={{ title: "Không còn việc chờ", description: "Mọi hồ sơ đã được xử lý." }}
            columns={[
              { header: "Loại", cell: (r) => label(inboxKindLabels, r.kind) },
              { header: "Nội dung", cell: (r) => <Link href={String(r.href)}>{String(r.title)}</Link> },
              { header: "Doanh nghiệp", cell: (r) => String(r.organizationName ?? "—") },
              { header: "Tạo lúc", cell: (r) => dateTime(r.createdAt) },
              { header: "Hạn xử lý", cell: (r) => dateTime(r.dueAt) },
              {
                header: "Trạng thái",
                cell: (r) => <StatusBadge value={r.overdue ? "FAILED" : "PENDING_REVIEW"} label={r.overdue ? "Quá hạn" : `Chờ ${String(r.ageHours)} giờ`} />,
              },
            ]}
          />
        </Section>
      )}
    </ManagePage>
  );
}
