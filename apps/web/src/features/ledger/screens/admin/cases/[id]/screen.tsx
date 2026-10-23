"use client";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale } from "@/components/ledger/locale";

import Link from "next/link";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { api } from "@/lib/ledger/cases-api";
import type { components } from "@/lib/generated/api";
type CaseEvent = components["schemas"]["PlatformCaseEventDto"];
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import { fmtDateTime, fmtDue } from "@/lib/ledger/format";
import { CASE_CATEGORY_LABEL, CASE_SOURCE_LABEL } from "@/lib/ledger/labels";
import {
  futureDateTime,
  localToIso,
  note,
} from "@/features/ledger/screens/admin/cases/schemas";
import { Button } from "@/components/ledger/ui/button";
import {
  CommandDialog,
  CommandForm,
  useDialog,
} from "@/components/ledger/kit/command-dialog";
import {
  ChoiceField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/ledger/kit/form-fields";
import { Guard } from "@/components/ledger/kit/guard";

import {
  Callout,
  ErrorState,
  Field,
  Fields,
  LoadingRows,
  PageBody,
  PageHeader,
  Section,
} from "@/components/ledger/kit/page";
import { Badge, Due, Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const SEV = [
  {
    value: "LOW",
    get label() {
      return tr("Thấp");
    },
  },
  {
    value: "MEDIUM",
    get label() {
      return tr("Trung bình");
    },
  },
  { value: "HIGH", label: "Cao" },
  {
    value: "CRITICAL",
    get label() {
      return tr("Nghiêm trọng");
    },
  },
];
const assignSchema = z.object({
  ownerOrganizationId: z.uuid(),
  responseDueAt: futureDateTime,
  note: note(10, 2000),
});
const classifySchema = z.object({
  category: z.enum(["QUALITY", "SAFETY", "LABELING", "COUNTERFEIT", "OTHER"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  note: note(10, 2000),
});
const linkSchema = z.object({ lotId: z.uuid(), note: note(10, 2000) });
const escalateSchema = z.object({ note: note(10, 2000) });
const closeSchema = z.object({ reason: note(10, 2000) });
const noteSchema = z.object({
  note: note(1, 2000),
  visibility: z.enum(["INTERNAL", "SHARED"]),
});

const ACTION_LABEL: Record<CaseEvent["action"], string> = {
  get CREATED() {
    return tr("Tiếp nhận");
  },
  get CLASSIFIED() {
    return tr("Phân loại");
  },
  get LOT_LINKED() {
    return tr("Gắn lô");
  },
  get ASSIGNED() {
    return tr("Giao doanh nghiệp");
  },
  get ACKNOWLEDGED() {
    return tr("Doanh nghiệp xác nhận");
  },
  get RESPONDED() {
    return tr("Doanh nghiệp phản hồi");
  },
  ESCALATED: "Leo thang",
  get NOTE() {
    return tr("Ghi chú");
  },
  get CLOSED() {
    return tr("Đóng hồ sơ");
  },
};

export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-cases-[id]">
      <Guard permission="cases.read">
        <Detail id={String(route.params.id)} />
      </Guard>
    </LedgerRouteScreen>
  );
}

type Act = "assign" | "classify" | "link" | "escalate" | "close";

function Detail({ id }: { id: string }) {
  const { can } = useSession();
  const q = useQuery({
    queryKey: ["case", id],
    queryFn: () => api.cases.get(id),
  });
  const options = useQuery({
    queryKey: ["case-orgs"],
    queryFn: api.cases.organizationOptions,
    enabled: can("cases.write"),
  });
  const act = useDialog<Act>();
  if (q.error)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={10} className="p-8" />;
  const c = q.data;
  const closed = c.status === "CLOSED";
  const writable = can("cases.write") && !closed;
  const invalidate = [["case", id], ["cases"], ["inbox"]];
  const due = c.responseDueAt ? fmtDue(c.responseDueAt) : null;
  const base = { version: c.version, invalidate };

  return (
    <div data-testid="ledger-case-detail">
      <PageHeader
        crumbs={[
          { href: "/admin/cases", label: tr("Hồ sơ sự cố") },
          { label: `#${c.caseNumber}` },
        ]}
        title={
          <>
            <span className="font-mono text-ink-2">#{c.caseNumber}</span>{" "}
            {c.title}
          </>
        }
        meta={
          <>
            <Status group="case" value={c.status} />
            <Status group="severity" value={c.severity} />
            {c.overdue && (
              <Badge tone="danger" dot={false}>
                {tr("Quá hạn phản hồi")}
              </Badge>
            )}
          </>
        }
        description={
          <>
            {CASE_CATEGORY_LABEL[c.category]} {tr("· nguồn")}{" "}
            {CASE_SOURCE_LABEL[c.source]} {tr("· tạo")}{" "}
            {fmtDateTime(c.createdAt)} ·{" "}
            <span className="font-mono">version {c.version}</span>
          </>
        }
        actions={
          writable && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => act.open("classify")}
              >
                {tr("Phân loại")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => act.open("link")}
              >
                {tr("Gắn lô")}
              </Button>
              {c.status !== "ESCALATED" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act.open("escalate")}
                >
                  Leo thang
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => act.open("close")}
              >
                {tr("Đóng hồ sơ")}
              </Button>
              <Button size="sm" onClick={() => act.open("assign")}>
                {c.owner ? tr("Giao lại") : tr("Giao doanh nghiệp")}
              </Button>
            </>
          )
        }
      />
      <PageBody wide>
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-5">
            <Section
              title={tr("Mô tả")}
              aside={tr(
                "Doanh nghiệp được giao nhìn thấy mô tả và các mục SHARED",
              )}
            >
              <p className="px-4 py-3 text-[13px] leading-relaxed whitespace-pre-line sm:px-5">
                {c.description}
              </p>
            </Section>
            <Section
              title={tr("Dòng thời gian")}
              aside={tr("{p0} sự kiện · append-only", { p0: c.events.length })}
            >
              <ol className="relative flex flex-col px-4 py-4 sm:px-5">
                {c.events.map((e, i) => (
                  <li
                    key={e.id}
                    className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-3 pb-5 last:pb-0"
                  >
                    {i < c.events.length - 1 && (
                      <span
                        aria-hidden
                        className="absolute top-4 bottom-0 left-[8px] w-px bg-line"
                      />
                    )}
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1 size-[17px] rounded-full border-2 bg-card",
                        e.visibility === "SHARED"
                          ? "border-brand"
                          : "border-line-strong",
                        e.action === "ESCALATED" && "border-warn-dot",
                        e.action === "CLOSED" && "border-ink bg-ink",
                      )}
                    />
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
                        <span className="font-semibold">
                          {ACTION_LABEL[e.action]}
                        </span>
                        <span className="text-ink-2">{e.actor.fullName}</span>
                        <span className="font-mono text-[11.5px] text-ink-2">
                          {fmtDateTime(e.createdAt)}
                        </span>
                        <Badge
                          tone={e.visibility === "SHARED" ? "brand" : "neutral"}
                          dot={false}
                          className="h-5 text-[11px]"
                        >
                          {e.visibility === "SHARED"
                            ? tr("Chia sẻ với DN")
                            : tr("Nội bộ")}
                        </Badge>
                      </div>
                      {e.note && (
                        <p className="text-[13px] text-ink">{e.note}</p>
                      )}
                      {Object.keys(e.details).length > 0 && (
                        <p className="font-mono text-[11.5px] text-ink-2">
                          {Object.entries(e.details)
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          </div>
          <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 lg:sticky lg:top-[68px] lg:max-w-[420px]">
            <Section title={tr("Tình trạng")}>
              <Fields cols={1}>
                <Field label={tr("Tổ chức phụ trách")}>
                  {c.owner ? (
                    <Link
                      className="text-brand hover:underline"
                      href={`/admin/organizations?organizationId=${c.owner.id}`}
                    >
                      {c.owner.name}
                    </Link>
                  ) : (
                    tr("Chưa giao")
                  )}
                </Field>
                <Field label={tr("Lô liên quan")}>
                  {c.lot ? (
                    <Link
                      className="font-mono text-brand hover:underline"
                      href={`/admin/lots/${c.lot.id}`}
                    >
                      {c.lot.lotCode}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Field>
                <Field label={tr("Hạn phản hồi")}>
                  {c.responseDueAt ? (
                    <span className="flex flex-wrap gap-2">
                      <span className="font-mono text-[12px]">
                        {fmtDateTime(c.responseDueAt)}
                      </span>
                      {!closed && due && (
                        <Due overdue={c.overdue}>{due.text}</Due>
                      )}
                    </span>
                  ) : (
                    "—"
                  )}
                </Field>
                <Field label={tr("DN xác nhận / phản hồi")}>
                  {fmtDateTime(c.acknowledgedAt)} / {fmtDateTime(c.respondedAt)}
                </Field>
                {closed && (
                  <Field label={tr("Lý do đóng")}>{c.closeReason}</Field>
                )}
              </Fields>
            </Section>
            {writable ? (
              <div className="rounded-md border border-line-strong bg-card p-5">
                <CommandForm
                  title={tr("Thêm ghi chú")}
                  endpoint="POST /platform-cases/:id/notes"
                  schema={noteSchema}
                  defaultValues={{ note: "", visibility: "INTERNAL" }}
                  submitLabel={tr("Ghi chú")}
                  invalidate={invalidate}
                  run={(v, cmd) => api.cases.note(id, v, cmd)}
                >
                  {(f) => (
                    <>
                      <TextAreaField
                        control={f.control}
                        name="note"
                        label={tr("Nội dung")}
                        max={2000}
                      />
                      <ChoiceField
                        control={f.control}
                        name="visibility"
                        label={tr("Hiển thị")}
                        options={[
                          { value: "INTERNAL", label: tr("Nội bộ nền tảng") },
                          {
                            value: "SHARED",
                            label: tr("Chia sẻ với doanh nghiệp được giao"),
                          },
                        ]}
                      />
                    </>
                  )}
                </CommandForm>
              </div>
            ) : (
              <Callout>
                {closed
                  ? tr("Hồ sơ đã đóng là bất biến.")
                  : tr("Vai hiện tại chỉ được xem (AUDITOR).")}
              </Callout>
            )}
            <Callout tone="info">
              {tr(
                "Thu hồi lô vẫn là lệnh của doanh nghiệp (FARM_STAFF/TRANSPORTER/RETAILER). Dùng Diễn tập thu hồi để xem phạm vi ảnh hưởng.",
              )}
            </Callout>
          </aside>
        </div>
      </PageBody>

      {act.target === "assign" && (
        <CommandDialog
          {...act.props}
          {...base}
          title={c.owner ? tr("Giao lại hồ sơ") : tr("Giao doanh nghiệp")}
          endpoint="POST /platform-cases/:id/assign"
          description={tr(
            "Giao lại xóa xác nhận/phản hồi cũ của doanh nghiệp. Ghi chú giao được chia sẻ với doanh nghiệp.",
          )}
          schema={assignSchema}
          defaultValues={{ ownerOrganizationId: c.owner?.id ?? "", note: "" }}
          submitLabel={tr("Giao hồ sơ")}
          run={(v, cmd) =>
            api.cases.assign(
              id,
              {
                ownerOrganizationId: v.ownerOrganizationId,
                responseDueAt: localToIso(v.responseDueAt),
                note: v.note,
                version: c.version,
              },
              cmd,
            )
          }
        >
          {(f) => (
            <>
              <SelectField
                control={f.control}
                name="ownerOrganizationId"
                label={tr("Tổ chức")}
                options={(options.data ?? []).map((o) => ({
                  value: o.id,
                  label: o.name,
                }))}
              />
              <TextField
                control={f.control}
                name="responseDueAt"
                label={tr("Hạn phản hồi")}
                type="datetime-local"
                hint={tr("Phải ở tương lai")}
              />
              <TextAreaField
                control={f.control}
                name="note"
                label={tr("Yêu cầu gửi doanh nghiệp")}
                max={2000}
              />
            </>
          )}
        </CommandDialog>
      )}
      {act.target === "classify" && (
        <CommandDialog
          {...act.props}
          {...base}
          title={tr("Phân loại lại")}
          endpoint="POST /platform-cases/:id/classify"
          schema={classifySchema}
          defaultValues={{
            category: c.category,
            severity: c.severity,
            note: "",
          }}
          submitLabel={tr("Ghi phân loại")}
          run={(v, cmd) =>
            api.cases.classify(id, { ...v, version: c.version }, cmd)
          }
        >
          {(f) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  control={f.control}
                  name="category"
                  label={tr("Loại")}
                  options={Object.entries(CASE_CATEGORY_LABEL).map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
                <SelectField
                  control={f.control}
                  name="severity"
                  label={tr("Mức độ")}
                  options={SEV}
                />
              </div>
              <TextAreaField
                control={f.control}
                name="note"
                label={tr("Căn cứ")}
                max={2000}
              />
            </>
          )}
        </CommandDialog>
      )}
      {act.target === "link" && (
        <CommandDialog
          {...act.props}
          {...base}
          title={tr("Gắn lô")}
          endpoint="POST /platform-cases/:id/link-lot"
          description={
            !c.owner
              ? tr(
                  "Hồ sơ chưa giao: gắn lô sẽ giao cho doanh nghiệp sản xuất lô.",
                )
              : undefined
          }
          schema={linkSchema}
          defaultValues={{ lotId: "", note: "" }}
          submitLabel={tr("Gắn lô")}
          run={(v, cmd) =>
            api.cases.linkLot(id, { ...v, version: c.version }, cmd)
          }
        >
          {(f) => (
            <>
              <TextField control={f.control} name="lotId" label={tr("Lô")} />
              <TextAreaField
                control={f.control}
                name="note"
                label={tr("Ghi chú")}
                max={2000}
              />
            </>
          )}
        </CommandDialog>
      )}
      {act.target === "escalate" && (
        <CommandDialog
          {...act.props}
          {...base}
          title={tr("Leo thang hồ sơ")}
          endpoint="POST /platform-cases/:id/escalate"
          description={tr(
            "Leo thang là quyết định của admin; Backend không tự leo thang khi quá hạn.",
          )}
          schema={escalateSchema}
          defaultValues={{ note: "" }}
          submitLabel="Leo thang"
          tone="danger"
          run={(v, cmd) =>
            api.cases.escalate(id, { ...v, version: c.version }, cmd)
          }
        >
          {(f) => (
            <TextAreaField
              control={f.control}
              name="note"
              label={tr("Lý do leo thang")}
              max={2000}
            />
          )}
        </CommandDialog>
      )}
      {act.target === "close" && (
        <CommandDialog
          {...act.props}
          {...base}
          title={tr("Đóng hồ sơ")}
          endpoint="POST /platform-cases/:id/close"
          description={tr(
            "Hồ sơ đã đóng là bất biến; lý do đóng được chia sẻ với doanh nghiệp.",
          )}
          schema={closeSchema}
          defaultValues={{ reason: "" }}
          submitLabel={tr("Đóng hồ sơ")}
          tone="danger"
          run={(v, cmd) =>
            api.cases.close(id, { ...v, version: c.version }, cmd)
          }
        >
          {(f) => (
            <TextAreaField
              control={f.control}
              name="reason"
              label={tr("Lý do đóng")}
              max={2000}
            />
          )}
        </CommandDialog>
      )}
    </div>
  );
}
