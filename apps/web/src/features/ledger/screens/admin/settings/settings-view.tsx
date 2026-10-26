"use client";
import { z } from "zod";
import { RefreshCw } from "lucide-react";
import { api, type Setting } from "@/lib/ledger/platform-api";
import { useLedgerQuery } from "@/lib/ledger/data";
import { reason } from "@/lib/ledger/platform-schemas";
import { fmtDateTime } from "@/lib/ledger/format";
import { t } from "@/lib/ledger/i18n";
import { Button } from "@/components/ledger/ui/button";
import {
  CommandDialog,
  useDialog,
} from "@/components/ledger/kit/command-dialog";
import { TextAreaField } from "@/components/ledger/kit/form-fields";
import { DataTable } from "@/components/ledger/kit/data-table";
import {
  Callout,
  EmptyState,
  PageBody,
  PageHeader,
} from "@/components/ledger/kit/page";
const schema = z.object({
  value: z.string().refine((s) => {
    try {
      JSON.parse(s);
      return true;
    } catch {
      return false;
    }
  }, "Nhập giá trị JSON hợp lệ"),
  reason: reason(),
});
export function SettingsView() {
  const q = useLedgerQuery({
      queryKey: ["platform-settings"],
      queryFn: api.governance.settings,
    }),
    edit = useDialog<Setting>();
  const row = edit.target;
  return (
    <>
      <PageHeader
        title={t("Tham số hệ thống")}
        description={t(
          "Thay đổi có lý do và phiên bản. Một số tham số cần người quản trị thứ hai phê duyệt.",
        )}
        actions={
          <Button variant="outline" size="sm" onClick={() => q.refetch()}>
            <RefreshCw />
            {t("Tải lại")}
          </Button>
        }
      />
      <PageBody>
        <Callout>
          {t(
            "Chỉ các tham số được phép sửa mới có thao tác cập nhật. Giá trị và phạm vi hợp lệ được kiểm tra khi ghi.",
          )}
        </Callout>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => q.refetch()}
            rowKey={(r) => r.key}
            columns={[
              {
                key: "name",
                header: t("Tham số"),
                cell: (r) => (
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[12px]">{r.key}</span>
                    <span className="text-ink-2">{r.description}</span>
                  </div>
                ),
              },
              {
                key: "value",
                header: t("Giá trị"),
                cell: (r) => (
                  <pre className="max-w-xs overflow-auto text-[12px]">
                    {JSON.stringify(r.value, null, 2)}
                  </pre>
                ),
              },
              {
                key: "updated",
                header: t("Cập nhật"),
                cell: (r) => (
                  <span className="text-[12px] text-ink-2">
                    {fmtDateTime(r.updatedAt)} · v{r.version}
                  </span>
                ),
              },
              {
                key: "action",
                header: t("Thao tác"),
                cell: (r) =>
                  r.editable ? (
                    <Button
                      size="xs"
                      variant="outline"
                      aria-label={`${t("Sửa")} ${r.key}`}
                      onClick={() => edit.open(r)}
                    >
                      {t("Sửa")}
                    </Button>
                  ) : (
                    <span className="text-ink-2">{t("Chỉ đọc")}</span>
                  ),
              },
            ]}
            empty={<EmptyState title={t("Chưa có tham số")} />}
          />
        </div>
      </PageBody>
      {row && (
        <CommandDialog
          {...edit.props}
          title={`${t("Sửa tham số")} · ${row.key}`}
          endpoint="POST /platform-admin/settings/:key"
          description={row.hint}
          schema={schema}
          defaultValues={{
            value: JSON.stringify(row.value, null, 2),
            reason: "",
          }}
          version={row.version}
          submitLabel={t("Ghi tham số")}
          invalidate={[["platform-settings"]]}
          run={(v, cmd) =>
            api.governance.changeSetting(
              row.key,
              {
                value: JSON.parse(v.value) as unknown,
                reason: v.reason,
                version: row.version,
              },
              cmd,
            )
          }
        >
          {(f) => (
            <>
              <TextAreaField
                control={f.control}
                name="value"
                label={t("Giá trị JSON")}
                hint={row.hint ?? undefined}
              />
              <TextAreaField
                control={f.control}
                name="reason"
                label={t("Lý do")}
              />
            </>
          )}
        </CommandDialog>
      )}
    </>
  );
}
