"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { z } from "zod";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { api } from "@/lib/ledger/operations-api";
import type { Plan, PlanVersion } from "@/lib/ledger/operations-types";
import { useLedgerSession } from "@/lib/ledger/platform-access";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/ledger/format";
import { reason } from "@/lib/ledger/platform-schemas";
import { Button } from "@/components/ledger/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ledger/ui/dialog";
import {
  CommandDialog,
  useDialog,
} from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { FilterBar, FilterSelect } from "@/components/ledger/kit/filters";
import { TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Guard } from "@/components/ledger/kit/guard";
import {
  Callout,
  EmptyState,
  PageBody,
  PageHeader,
  Section,
} from "@/components/ledger/kit/page";
import { Badge, Code, Status } from "@/components/ledger/kit/status";
import { t as tr } from "@/lib/ledger/i18n";

const int = (min: number, max: number) =>
  z.coerce
    .number<number>({ error: () => tr("Nhập số") })
    .int({ error: () => tr("Số nguyên") })
    .min(min, `≥ ${min}`)
    .max(max, `≤ ${fmtNumber(max)}`);
const draftSchema = z.object({
  setupFee: int(0, 1e10),
  annualFee: int(0, 1e10),
  termMonths: int(1, 60),
  chains: int(0, 1000),
  partners: int(0, 100000),
  members: int(1, 100000),
  products: int(0, 100000),
  note: z
    .string()
    .trim()
    .min(10, { error: () => tr("Tối thiểu 10 ký tự") })
    .max(1000),
});
const createSchema = draftSchema.extend({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/, {
      error: () =>
        tr("Mã gồm 2–30 chữ in hoa, số hoặc dấu gạch dưới; bắt đầu bằng chữ"),
    }),
  name: z
    .string()
    .trim()
    .min(1, { error: () => tr("Không được để trống") })
    .max(120),
  description: z.string().trim().max(1000).optional(),
});
const reasonSchema = z.object({ reason: reason() });
const defaults = {
  setupFee: 0,
  annualFee: 0,
  termMonths: 12,
  chains: 1,
  partners: 10,
  members: 10,
  products: 5,
  note: "",
};
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
const currentVersion = (plan: Plan) =>
  plan.versions.find((v) => v.status === "PUBLISHED") ??
  plan.versions.find((v) => v.status === "DRAFT") ??
  plan.versions[0];
const availability = (plan: Plan) =>
  plan.status === "RETIRED"
    ? "RETIRED"
    : plan.versions.some((v) => v.status === "PUBLISHED")
      ? "AVAILABLE"
      : "DRAFT";
function PlanStatus({ plan }: { plan: Plan }) {
  const state = availability(plan);
  return (
    <Badge
      tone={
        state === "AVAILABLE" ? "ok" : state === "DRAFT" ? "warn" : "neutral"
      }
    >
      {tr(
        state === "AVAILABLE"
          ? "Đang cung cấp"
          : state === "DRAFT"
            ? "Chưa công bố"
            : "Ngừng cung cấp",
      )}
    </Badge>
  );
}
function PriceFields({
  render,
}: {
  render: (
    name: keyof z.infer<typeof draftSchema>,
    label: string,
  ) => React.ReactNode;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {render("setupFee", tr("Phí khởi tạo (VND)"))}
        {render("annualFee", tr("Phí năm (VND)"))}
        {render("termMonths", tr("Kỳ hạn (tháng)"))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {render("products", tr("Sản phẩm"))}
        {render("chains", tr("Chuỗi"))}
        {render("partners", tr("Đối tác trong chuỗi"))}
        {render("members", tr("Nhân viên"))}
      </div>
      {render("note", tr("Ghi chú thay đổi"))}
    </>
  );
}

export function Plans() {
  const { can } = useLedgerSession();
  const q = useQuery({ queryKey: ["plans"], queryFn: api.billing.plans });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const create = useDialog();
  const draft = useDialog<Plan>();
  const publish = useDialog<PlanVersion>();
  const change = useDialog<Plan>();
  const history = useDialog<Plan>();
  const invalidate = [["plans"], ["inbox"], ["ws-service"], ["ws-billing"]];
  const base = draft.target && currentVersion(draft.target);
  const shown =
    history.target &&
    (q.data?.find((p) => p.code === history.target!.code) ?? history.target);
  const rows = q.data?.filter(
    (p) =>
      (!search.trim() ||
        normalize(`${p.name} ${p.code}`).includes(normalize(search.trim()))) &&
      (!status || availability(p) === status),
  );
  const columns: Column<Plan>[] = [
    {
      key: "name",
      header: tr("Gói dịch vụ"),
      sort: (p) => p.name,
      cell: (p) => (
        <div className="min-w-40 py-1">
          <div className="font-semibold">{p.name}</div>
          <Code>{p.code}</Code>
        </div>
      ),
    },
    {
      key: "version",
      header: tr("Phiên bản"),
      cell: (p) => {
        const v = currentVersion(p);
        return v ? (
          <div>
            <span className="font-mono">v{v.version}</span>
            <div className="text-xs text-ink-2">
              {v.termMonths} {tr("tháng")}
            </div>
            {p.versions.some((x) => x.status === "DRAFT") && (
              <span className="text-xs text-warn">{tr("Có bản nháp")}</span>
            )}
          </div>
        ) : (
          "—"
        );
      },
    },
    {
      key: "setup",
      header: tr("Phí khởi tạo"),
      headClassName: "text-right",
      className: "text-right font-mono whitespace-nowrap",
      sort: (p) => currentVersion(p)?.setupFee ?? 0,
      cell: (p) =>
        currentVersion(p) ? fmtMoney(currentVersion(p)!.setupFee) : "—",
    },
    {
      key: "annual",
      header: tr("Phí năm"),
      headClassName: "text-right",
      className: "text-right font-mono whitespace-nowrap",
      sort: (p) => currentVersion(p)?.annualFee ?? 0,
      cell: (p) =>
        currentVersion(p) ? fmtMoney(currentVersion(p)!.annualFee) : "—",
    },
    {
      key: "limits",
      header: tr("Hạn mức"),
      cell: (p) => {
        const v = currentVersion(p);
        return v ? (
          <div className="min-w-40 text-xs leading-5">
            <div>
              {fmtNumber(v.limits.products)} {tr("sản phẩm")} ·{" "}
              {fmtNumber(v.limits.chains)} {tr("chuỗi")}
            </div>
            <div className="text-ink-2">
              {fmtNumber(v.limits.partners ?? 0)} {tr("đối tác")} ·{" "}
              {fmtNumber(v.limits.members)} {tr("nhân viên")}
            </div>
          </div>
        ) : (
          "—"
        );
      },
    },
    {
      key: "using",
      header: tr("Đang dùng"),
      className: "text-right font-mono",
      headClassName: "text-right",
      sort: (p) =>
        p.versions.reduce((n, v) => n + (v.activeSubscriptions ?? 0), 0),
      cell: (p) =>
        fmtNumber(
          p.versions.reduce((n, v) => n + (v.activeSubscriptions ?? 0), 0),
        ),
    },
    {
      key: "status",
      header: tr("Trạng thái"),
      cell: (p) => <PlanStatus plan={p} />,
    },
    {
      key: "actions",
      header: tr("Thao tác"),
      cell: (p) => (
        <div className="flex flex-wrap items-center gap-1 min-w-48">
          <Button
            size="xs"
            variant="outline"
            aria-label={tr("Chi tiết gói {p0}", { p0: p.name })}
            onClick={() => history.open(p)}
          >
            {tr("Chi tiết")}
          </Button>
          {can("billing.write") && (
            <Button size="xs" variant="outline" onClick={() => change.open(p)}>
              {tr(p.status === "ACTIVE" ? "Ngừng cung cấp" : "Mở lại")}
            </Button>
          )}
        </div>
      ),
    },
  ];
  const versionColumns: Column<PlanVersion>[] = [
    {
      key: "version",
      header: tr("Phiên bản"),
      cell: (v) => `v${v.version} · ${v.termMonths} ${tr("tháng")}`,
    },
    {
      key: "setup",
      header: tr("Phí khởi tạo"),
      cell: (v) => fmtMoney(v.setupFee),
    },
    {
      key: "annual",
      header: tr("Phí năm"),
      cell: (v) => fmtMoney(v.annualFee),
    },
    {
      key: "limits",
      header: tr("Hạn mức"),
      cell: (v) => (
        <div className="min-w-40 text-xs leading-5">
          <div>
            {fmtNumber(v.limits.products)} {tr("sản phẩm")} ·{" "}
            {fmtNumber(v.limits.chains)} {tr("chuỗi")}
          </div>
          <div className="text-ink-2">
            {fmtNumber(v.limits.partners ?? 0)} {tr("đối tác")} ·{" "}
            {fmtNumber(v.limits.members)} {tr("nhân viên")}
          </div>
        </div>
      ),
    },
    {
      key: "note",
      header: tr("Ghi chú"),
      cell: (v) => (
        <span className="block max-w-48 whitespace-normal break-words text-xs text-ink-2">
          {v.note || "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: tr("Trạng thái"),
      cell: (v) => (
        <div className="flex flex-wrap items-center gap-2">
          <Status group="plan" value={v.status} />
          {v.publishedAt && (
            <span className="text-xs text-ink-2">{fmtDate(v.publishedAt)}</span>
          )}
          {v.status === "DRAFT" &&
            shown?.status === "ACTIVE" &&
            can("billing.write") && (
              <Button
                size="xs"
                onClick={() => {
                  history.close();
                  publish.open(v);
                }}
              >
                {tr("Công bố")}
              </Button>
            )}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title={tr("Quản lý gói dịch vụ")}
        description={tr(
          "Thêm gói, quản lý phiên bản và ngừng cung cấp trong một danh sách.",
        )}
        actions={
          can("billing.write") && (
            <Button onClick={() => create.open(true)}>
              <Plus />
              {tr("Thêm gói dịch vụ")}
            </Button>
          )
        }
      />
      <PageBody>
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder={tr("Tên hoặc mã gói")}
          active={!!(search || status)}
          onReset={() => {
            setSearch("");
            setStatus("");
          }}
        >
          <FilterSelect
            label={tr("Trạng thái")}
            value={status}
            onChange={setStatus}
            options={[
              { value: "AVAILABLE", label: tr("Đang cung cấp") },
              { value: "DRAFT", label: tr("Chưa công bố") },
              { value: "RETIRED", label: tr("Ngừng cung cấp") },
            ]}
          />
          {q.data && (
            <span className="text-xs text-ink-2">
              {tr("Hiển thị {p0}/{p1} gói", {
                p0: rows?.length ?? 0,
                p1: q.data.length,
              })}
            </span>
          )}
        </FilterBar>
        <Section title={tr("Danh sách gói dịch vụ")}>
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(p) => p.code}
            loading={!q.data && !q.error}
            error={q.error}
            onRetry={() => q.refetch()}
            minWidth={1120}
            caption={tr("Danh sách gói dịch vụ")}
            empty={
              <EmptyState
                title={
                  q.data?.length
                    ? tr("Không có gói phù hợp")
                    : tr("Chưa có gói dịch vụ")
                }
              />
            }
          />
        </Section>
        <p className="text-xs text-ink-2">
          {tr(
            "Ngừng cung cấp chỉ dừng đăng ký và gia hạn mới. Dịch vụ đang sử dụng, hóa đơn và hợp đồng cũ được giữ nguyên.",
          )}
        </p>
      </PageBody>
      <CommandDialog
        {...create.props}
        title={tr("Thêm gói dịch vụ")}
        description={tr(
          "Gói mới được lưu với phiên bản nháp. Công bố sau khi kiểm tra để doanh nghiệp có thể lựa chọn.",
        )}
        endpoint="POST /platform-billing/plans"
        schema={createSchema}
        defaultValues={{ ...defaults, code: "", name: "", description: "" }}
        submitLabel={tr("Thêm gói và lưu bản nháp")}
        invalidate={invalidate}
        wide
        run={(v, cmd) =>
          api.billing.createPlan(
            {
              code: v.code,
              name: v.name,
              description: v.description,
              setupFee: v.setupFee,
              annualFee: v.annualFee,
              termMonths: v.termMonths,
              limits: {
                chains: v.chains,
                partners: v.partners,
                members: v.members,
                products: v.products,
              },
              note: v.note,
            },
            cmd,
          )
        }
      >
        {(f) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                control={f.control}
                name="code"
                label={tr("Mã gói")}
                hint={tr("Ví dụ: TRACE_TEST_1K. Không đổi mã sau khi tạo.")}
              />
              <TextField
                control={f.control}
                name="name"
                label={tr("Tên gói dịch vụ")}
              />
            </div>
            <TextAreaField
              control={f.control}
              name="description"
              label={tr("Mô tả gói")}
            />
            <PriceFields
              render={(name, label) =>
                name === "note" ? (
                  <TextAreaField
                    control={f.control}
                    name={name}
                    label={label}
                    hint={tr("10–1000 ký tự")}
                  />
                ) : (
                  <TextField
                    control={f.control}
                    name={name}
                    label={label}
                    type="number"
                  />
                )
              }
            />
          </>
        )}
      </CommandDialog>
      {draft.target && (
        <CommandDialog
          {...draft.props}
          title={tr("Phiên bản nháp · {p0}", { p0: draft.target.name })}
          endpoint="POST /platform-billing/plans/:code/versions"
          description={tr(
            "Bản nháp chưa áp dụng cho báo giá; chỉ có hiệu lực sau khi công bố.",
          )}
          schema={draftSchema}
          defaultValues={
            base
              ? {
                  setupFee: base.setupFee,
                  annualFee: base.annualFee,
                  termMonths: base.termMonths,
                  ...base.limits,
                  note: "",
                }
              : defaults
          }
          submitLabel={tr("Lưu bản nháp")}
          invalidate={invalidate}
          wide
          run={(v, cmd) =>
            api.billing.draftVersion(
              draft.target!.code,
              {
                setupFee: v.setupFee,
                annualFee: v.annualFee,
                termMonths: v.termMonths,
                limits: {
                  chains: v.chains,
                  partners: v.partners,
                  members: v.members,
                  products: v.products,
                },
                note: v.note,
              },
              cmd,
            )
          }
        >
          {(f) => (
            <PriceFields
              render={(name, label) =>
                name === "note" ? (
                  <TextAreaField
                    control={f.control}
                    name={name}
                    label={label}
                    hint={tr("10–1000 ký tự")}
                  />
                ) : (
                  <TextField
                    control={f.control}
                    name={name}
                    label={label}
                    type="number"
                  />
                )
              }
            />
          )}
        </CommandDialog>
      )}
      {publish.target && (
        <CommandDialog
          {...publish.props}
          title={tr("Công bố {p0} v{p1}", {
            p0: publish.target.planCode,
            p1: publish.target.version,
          })}
          endpoint="POST /platform-billing/plan-versions/:id/publish"
          description={tr(
            "Phiên bản mới áp dụng cho đăng ký và gia hạn sau khi công bố. Hợp đồng đã xác nhận không thay đổi.",
          )}
          schema={reasonSchema}
          defaultValues={{ reason: "" }}
          submitLabel={tr("Công bố")}
          invalidate={invalidate}
          run={(v, cmd) =>
            api.billing.publishVersion(publish.target!.id, v, cmd)
          }
        >
          {(f) => (
            <TextAreaField
              control={f.control}
              name="reason"
              label={tr("Lý do công bố")}
            />
          )}
        </CommandDialog>
      )}
      {change.target && (
        <CommandDialog
          {...change.props}
          title={tr(
            change.target.status === "ACTIVE"
              ? "Ngừng cung cấp gói {p0}"
              : "Mở lại gói {p0}",
            { p0: change.target.name },
          )}
          description={tr(
            change.target.status === "ACTIVE"
              ? "Doanh nghiệp không thể chọn hoặc gia hạn gói này. Dịch vụ đã đăng ký và hợp đồng cũ vẫn được giữ nguyên."
              : "Gói có phiên bản đã công bố sẽ xuất hiện lại để doanh nghiệp lựa chọn. Gói chỉ có bản nháp vẫn cần công bố.",
          )}
          endpoint="POST /platform-billing/plans/:code/status"
          schema={reasonSchema}
          defaultValues={{ reason: "" }}
          submitLabel={tr(
            change.target.status === "ACTIVE"
              ? "Xác nhận ngừng cung cấp"
              : "Xác nhận mở lại",
          )}
          tone={change.target.status === "ACTIVE" ? "danger" : "default"}
          invalidate={invalidate}
          run={(v, cmd) =>
            api.billing.setPlanStatus(
              change.target!.code,
              {
                ...v,
                expectedStatus: change.target!.status as "ACTIVE" | "RETIRED",
                status:
                  change.target!.status === "ACTIVE" ? "RETIRED" : "ACTIVE",
              },
              cmd,
            )
          }
        >
          {(f) => (
            <TextAreaField
              control={f.control}
              name="reason"
              label={tr("Lý do thay đổi")}
            />
          )}
        </CommandDialog>
      )}
      {shown && (
        <Dialog {...history.props}>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{shown.name}</DialogTitle>
              <DialogDescription>
                {shown.code}
                {shown.description ? ` · ${shown.description}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 min-w-0">
              <PlanStatus plan={shown} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-sm">
                  {tr("Lịch sử phiên bản")}
                </h3>
                {can("billing.write") && shown.status === "ACTIVE" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={shown.versions.some((v) => v.status === "DRAFT")}
                    onClick={() => {
                      history.close();
                      draft.open(shown);
                    }}
                  >
                    {tr("Tạo phiên bản nháp")}
                  </Button>
                )}
              </div>
              <DataTable
                rows={shown.versions}
                columns={versionColumns}
                rowKey={(v) => v.id}
                minWidth={900}
                pageSize={10}
              />
              {shown.versions.some((v) => v.status === "DRAFT") && (
                <Callout>
                  {tr(
                    "Bản nháp chưa áp dụng cho báo giá; chỉ có hiệu lực sau khi công bố.",
                  )}
                </Callout>
              )}
            </div>
          </DialogContent>
        </Dialog>
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
    <LedgerRouteScreen route={route} name="admin-billing">
      <Guard permission="billing.read">
        <Plans />
      </Guard>
    </LedgerRouteScreen>
  );
}
