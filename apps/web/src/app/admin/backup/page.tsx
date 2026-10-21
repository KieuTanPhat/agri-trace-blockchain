"use client";

import { useWorkspaceData } from "@/lib/workspace";
import { DetailList, LoadState, ManagePage, PageHeader, ReloadButton, Section } from "@/components/manage";
import { dateTime, text, type RecordOf } from "@/lib/platform-admin";

type Backup = { available: boolean; receipt?: Record<string, unknown>; note: string };

/** Backups and restores run on the host controller under the production
 * runbook; this page only shows the receipt the operator publishes. */
export default function BackupPage() {
  const state = useWorkspaceData<RecordOf<Backup>>("/platform-admin/backup");
  const b = state.data?.record;
  return (
    <ManagePage>
      <PageHeader
        title="Sao lưu & khôi phục"
        description="Chỉ xem biên nhận sao lưu gần nhất. Sao lưu, khôi phục và rollback thực hiện qua controller theo runbook vận hành, không chạy từ trình duyệt."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <LoadState loading={state.loading} error={state.error} />
      {b && (
        <Section title={b.available ? "Biên nhận sao lưu gần nhất" : "Chưa có biên nhận"}>
          {b.receipt && (
            <DetailList
              items={[
                ["Sao lưu lúc", dateTime(b.receipt.lastBackupAt)],
                ["Kiểm chứng lúc", dateTime(b.receipt.verifiedAt)],
                ["Trạng thái", text(b.receipt.status)],
                ["Revision", text(b.receipt.revision)],
                ["SHA", text(b.receipt.sha)],
                ["Phạm vi", text(b.receipt.scope)],
                ["Host", text(b.receipt.host)],
                ["Lưu giữ", text(b.receipt.retention)],
              ]}
            />
          )}
          <p className="notice">{b.note}</p>
        </Section>
      )}
    </ManagePage>
  );
}
