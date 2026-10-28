"use client";
import { api } from "@/lib/ledger/platform-api";
import { useLedgerQuery } from "@/lib/ledger/data";
import { fmtDateTime } from "@/lib/ledger/format";
import { t } from "@/lib/ledger/i18n";
import { Connections } from "./[id]/screen";
import { Code, Status } from "@/components/ledger/kit/status";
import {
  EmptyState,
  ErrorState,
  Field,
  Fields,
  LoadingRows,
  PageBody,
  PageHeader,
  Section,
} from "@/components/ledger/kit/page";
export function ConnectionDetail({
  id,
  connectionId,
}: {
  id: string;
  connectionId: string;
}) {
  const q = useLedgerQuery({
    queryKey: ["enrollment", id],
    queryFn: () => api.enterprises.enrollment(id),
  });
  if (q.error)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  const e = q.data,
    c = e.connections.find((c) => c.id === connectionId);
  if (!c) return <EmptyState title={t("Không tìm thấy kết nối")} />;
  return (
    <>
      <PageHeader
        title={t("Xét kết nối blockchain")}
        crumbs={[
          { href: "/admin/enterprises", label: t("Hồ sơ đăng ký") },
          { href: `/admin/enterprises/${id}`, label: e.organizationName },
          { label: t("Kết nối") },
        ]}
        meta={<Status group="connection" value={c.status} />}
      />
      <PageBody>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            <Section title={t("Thông tin kết nối")}>
              <Fields>
                <Field label={t("Chuỗi")}>
                  <Code>{c.chainId}</Code>
                </Field>
                <Field label={t("Mô hình kết nối")}>{c.hostingMode}</Field>
                <Field label={t("Kiểm tra gần nhất")}>
                  {fmtDateTime(c.checkedAt)}
                </Field>
                <Field label={t("Phiên bản")}>{c.version}</Field>
                <Field label={t("Mã giao dịch")}>{c.txId ?? "—"}</Field>
                <Field label={t("Mã lỗi")}>{c.errorCode ?? "—"}</Field>
                <Field label={t("Ghi chú xét duyệt")}>
                  {c.reviewNote ?? "—"}
                </Field>
              </Fields>
            </Section>
            <Section title={t("Cấu hình công khai")}>
              <pre className="overflow-x-auto p-5 font-mono text-[12px] whitespace-pre-wrap break-all">
                {JSON.stringify(c.publicConfig, null, 2)}
              </pre>
            </Section>
            <Section title={t("Bằng chứng kiểm tra")}>
              <pre className="overflow-x-auto p-5 font-mono text-[12px] whitespace-pre-wrap break-all">
                {JSON.stringify(c.evidence ?? {}, null, 2)}
              </pre>
            </Section>
          </div>
          <Connections
            e={{ ...e, connections: [c] }}
            invalidate={[["enrollment", id], ["enrollments"], ["inbox"]]}
          />
        </div>
      </PageBody>
    </>
  );
}
