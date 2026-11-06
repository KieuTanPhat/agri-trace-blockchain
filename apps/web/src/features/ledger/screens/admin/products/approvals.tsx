"use client";
import { z } from "zod";
import { Section, EmptyState } from "@/components/ledger/kit/page";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { SelectField, TextAreaField } from "@/components/ledger/kit/form-fields";
import { Button } from "@/components/ledger/ui/button";
import { api } from "@/lib/ledger/operations-api";
import { useLedgerQuery } from "@/lib/ledger/data";
import { fmtDateTime } from "@/lib/ledger/format";
import { t } from "@/lib/ledger/i18n";

type Item = Awaited<ReturnType<typeof api.productApprovals.list>>[number];
const schema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().min(5, { error: () => t("Ghi chú từ 5 ký tự") }).max(1000),
});

/** Chain owners' product declarations waiting for approval; approval only
 * opens the public brand page, lot recording never waits for it (ADR-005). */
export function ProductApprovals() {
  const q = useLedgerQuery({ queryKey: ["product-approvals"], queryFn: api.productApprovals.list });
  const review = useDialog<Item>();
  const cols: Column<Item>[] = [
    { key: "product", header: t("Sản phẩm"), cell: (r) => <span className="font-medium">{r.productName}</span> },
    { key: "org", header: t("Chủ chuỗi"), cell: (r) => r.organizationName ?? "—" },
    { key: "at", header: t("Gửi lúc"), hideBelow: "md", cell: (r) => (r.approvalRequestedAt ? fmtDateTime(r.approvalRequestedAt) : "—") },
    { key: "act", header: <span className="sr-only">{t("Thao tác")}</span>, cell: (r) => <Button size="xs" variant="outline" onClick={() => review.open(r)}>{t("Xét duyệt")}</Button> },
  ];
  return (
    <Section title={t("Sản phẩm chờ duyệt trang thương hiệu")}>
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={cols} rowKey={(r) => r.productId} empty={<EmptyState title={t("Không có sản phẩm chờ duyệt")} />} />
      {review.target && (
        <CommandDialog
          {...review.props}
          title={t("Duyệt {p0}", { p0: review.target.productName })}
          description={t("Kiểm tra bản công bố hoặc chứng nhận chất lượng trong hồ sơ sản phẩm trước khi duyệt.")}
          endpoint="POST /platform-admin/product-approvals/:productId/review"
          schema={schema}
          defaultValues={{ decision: "APPROVE" as const, note: "" }}
          submitLabel={t("Ghi kết quả")}
          invalidate={[["product-approvals"]]}
          run={(v, cmd) => api.productApprovals.review(review.target!.productId, { ...v, version: review.target!.version }, cmd)}
        >
          {(f) => (
            <>
              <SelectField control={f.control} name="decision" label={t("Kết quả")} options={[{ value: "APPROVE", label: t("Duyệt") }, { value: "REJECT", label: t("Từ chối") }]} />
              <TextAreaField control={f.control} name="note" label={t("Ghi chú")} />
            </>
          )}
        </CommandDialog>
      )}
    </Section>
  );
}
