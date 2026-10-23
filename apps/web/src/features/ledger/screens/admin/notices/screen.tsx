"use client";

import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { Plus } from "lucide-react";
import { api } from "@/lib/ledger/coordination-api";
import type { Notice } from "@/lib/ledger/coordination-api";
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import { fmtDateTime } from "@/lib/ledger/format";
import { AUDIENCE_LABEL } from "@/lib/ledger/labels";
import { useNow } from "@/lib/ledger/use-now";
import { isoToLocal, localToIso } from "@/features/ledger/privacy/schemas";
import { reason } from "@/lib/ledger/platform-schemas";
import { Button } from "@/components/ledger/ui/button";
import {
  CommandDialog,
  useDialog,
} from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/ledger/kit/form-fields";
import { Guard } from "@/components/ledger/kit/guard";
import { EmptyState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge, Status } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
const DAY = 86_400_000;
const publishSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, { error: () => tr("Tối thiểu 3 ký tự") })
      .max(200),
    body: z
      .string()
      .trim()
      .min(3, { error: () => tr("Tối thiểu 3 ký tự") })
      .max(2000),
    audience: z.enum([
      "ALL",
      "PLATFORM",
      "ENTERPRISE",
      "FARM",
      "TRANSPORTER",
      "PROCESSOR",
      "DISTRIBUTOR",
      "RETAILER",
    ]),
    severity: z.enum(["INFO", "WARNING", "MAINTENANCE"]),
    startsAt: z.string().min(1, { error: () => tr("Bắt buộc") }),
    endsAt: z.string().min(1, { error: () => tr("Bắt buộc") }),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    path: ["endsAt"],
    error: () => tr("Phải sau thời điểm bắt đầu"),
  })
  .refine((v) => Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 90 * DAY, {
    path: ["endsAt"],
    error: () => tr("Tối đa 90 ngày"),
  });
const withdrawSchema = z.object({ reason: reason() });

function NoticesPage() {
  return (
    <Guard permission="notices.read">
      <Notices />
    </Guard>
  );
}

function Notices() {
  const { can } = useSession();
  const q = useQuery({ queryKey: ["notices"], queryFn: api.config.notices });
  const publish = useDialog();
  const withdraw = useDialog<Notice>();
  const invalidate = [["notices"], ["notices-active"]];
  const columns: Column<Notice>[] = [
    {
      key: "title",
      header: tr("Thông báo"),
      cell: (n) => (
        <span className="flex flex-col">
          <span className="font-medium">{n.title}</span>
          <span className="line-clamp-1 text-[12px] text-ink-2">{n.body}</span>
        </span>
      ),
    },
    {
      key: "aud",
      header: tr("Đối tượng"),
      cell: (n) => (
        <span className="text-[12px]">{AUDIENCE_LABEL[n.audience]}</span>
      ),
    },
    {
      key: "sev",
      header: tr("Loại"),
      cell: (n) => <Status group="noticeSeverity" value={n.severity} />,
    },
    {
      key: "time",
      header: tr("Hiển thị"),
      sort: (n) => n.startsAt,
      cell: (n) => (
        <span className="font-mono text-[12px]">
          {fmtDateTime(n.startsAt)} → {fmtDateTime(n.endsAt)}
        </span>
      ),
    },
    {
      key: "status",
      header: tr("Trạng thái"),
      cell: (n) => (
        <span className="flex gap-1">
          <Status group="notice" value={n.status} />
          {n.active && (
            <Badge tone="brand" dot={false}>
              {tr("đang hiện")}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "act",
      headClassName: "relative",
      header: <span className="sr-only">{tr("Thao tác")}</span>,
      cell: (n) =>
        can("notices.write") && n.status === "PUBLISHED" ? (
          <Button size="xs" variant="outline" onClick={() => withdraw.open(n)}>
            {tr("Thu hồi")}
          </Button>
        ) : null,
    },
  ];
  const now = useNow();
  return (
    <>
      <PageHeader
        title={tr("Thông báo hệ thống")}
        description={tr(
          "Banner theo đối tượng và khung thời gian (tối đa 90 ngày), độc lập với chế độ khóa ghi của controller.",
        )}
        actions={
          can("notices.write") && (
            <Button size="sm" onClick={() => publish.open(true)}>
              <Plus /> {tr("Đăng thông báo")}
            </Button>
          )
        }
      />
      <PageBody>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => q.refetch()}
            columns={columns}
            rowKey={(n) => n.id}
            empty={<EmptyState title={tr("Chưa có thông báo")} />}
          />
        </div>
      </PageBody>
      <CommandDialog
        {...publish.props}
        title={tr("Đăng thông báo hệ thống")}
        endpoint="POST /platform-admin/notices"
        schema={publishSchema}
        defaultValues={{
          title: "",
          body: "",
          audience: "ALL",
          severity: "INFO",
          startsAt: isoToLocal(new Date(now).toISOString()),
          endsAt: isoToLocal(new Date(now + 3 * DAY).toISOString()),
        }}
        submitLabel={tr("Đăng")}
        invalidate={invalidate}
        wide
        run={(v, cmd) =>
          api.config.publishNotice(
            {
              ...v,
              startsAt: localToIso(v.startsAt)!,
              endsAt: localToIso(v.endsAt)!,
            },
            cmd,
          )
        }
      >
        {(f) => (
          <>
            <TextField
              control={f.control}
              name="title"
              label={tr("Tiêu đề")}
              max={200}
            />
            <TextAreaField
              control={f.control}
              name="body"
              label={tr("Nội dung")}
              max={2000}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                control={f.control}
                name="audience"
                label={tr("Đối tượng")}
                options={Object.entries(AUDIENCE_LABEL).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
              <SelectField
                control={f.control}
                name="severity"
                label={tr("Loại")}
                options={[
                  { value: "INFO", label: tr("Thông tin") },
                  { value: "WARNING", label: tr("Cảnh báo") },
                  { value: "MAINTENANCE", label: tr("Bảo trì") },
                ]}
              />
              <TextField
                control={f.control}
                name="startsAt"
                label={tr("Bắt đầu")}
                type="datetime-local"
              />
              <TextField
                control={f.control}
                name="endsAt"
                label={tr("Kết thúc")}
                type="datetime-local"
              />
            </div>
          </>
        )}
      </CommandDialog>
      {withdraw.target && (
        <CommandDialog
          {...withdraw.props}
          title={tr("Thu hồi “{p0}”", { p0: withdraw.target.title })}
          endpoint="POST /platform-admin/notices/:id/withdraw"
          schema={withdrawSchema}
          defaultValues={{ reason: "" }}
          version={withdraw.target.version}
          tone="danger"
          submitLabel={tr("Thu hồi")}
          invalidate={invalidate}
          run={(v, cmd) =>
            api.config.withdrawNotice(
              withdraw.target!.id,
              { ...v, version: withdraw.target!.version },
              cmd,
            )
          }
        >
          {(f) => (
            <TextAreaField
              control={f.control}
              name="reason"
              label={tr("Lý do")}
            />
          )}
        </CommandDialog>
      )}
    </>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-notices">
      <div
        data-testid="ledger-notices-workspace"
        className="flex min-w-0 flex-1 flex-col"
      >
        <NoticesPage />
      </div>
    </LedgerRouteScreen>
  );
}
