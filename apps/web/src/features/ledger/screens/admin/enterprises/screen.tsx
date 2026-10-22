"use client";

import { useMemo, useState } from "react";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { api } from "@/lib/ledger/platform-api";
import type { Enrollment } from "@/lib/ledger/platform-api";
import { fmtAgo, fmtDateTime } from "@/lib/ledger/format";
import { CAPABILITY_LABEL, MODEL_LABEL } from "@/lib/ledger/labels";
import { Input } from "@/components/ledger/ui/input";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { Guard } from "@/components/ledger/kit/guard";
import { EmptyState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const STAGES = [
  {
    key: "PENDING_REVIEW",
    get label() {
      return tr("Chờ xét duyệt");
    },
  },
  {
    key: "CAP_PENDING",
    get label() {
      return tr("Năng lực xin thêm");
    },
  },
  {
    key: "AWAITING_ACTIVATION",
    get label() {
      return tr("Chờ kích hoạt");
    },
  },
  {
    key: "ACTIVE",
    get label() {
      return tr("Đang hoạt động");
    },
  },
  {
    key: "REJECTED",
    get label() {
      return tr("Đã trả hồ sơ");
    },
  },
  {
    key: "ALL",
    get label() {
      return tr("Tất cả");
    },
  },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

const match = (e: Enrollment, k: StageKey) =>
  k === "ALL" ||
  (k === "CAP_PENDING"
    ? e.status === "APPROVED" &&
      e.capabilityRequests.some((c) => c.status === "PENDING")
    : k === "ACTIVE"
      ? ["ACTIVE", "ACTIVE_LEGACY"].includes(e.onboardingStage)
      : e.onboardingStage === k);

function PreviewScreen() {
  return (
    <Guard permission="enrollment.read">
      <Enrollments />
    </Guard>
  );
}

function Enrollments() {
  const q = useQuery({
    queryKey: ["enrollments"],
    queryFn: api.enterprises.enrollments,
  });
  const [stage, setStage] = useState<StageKey>("PENDING_REVIEW");
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter(
      (e) =>
        match(e, stage) &&
        (!s ||
          e.organizationName.toLowerCase().includes(s) ||
          (e.businessId ?? "").includes(s) ||
          e.representativeEmail.toLowerCase().includes(s)),
    );
  }, [q.data, stage, search]);

  const columns: Column<Enrollment>[] = [
    {
      key: "org",
      header: tr("Tổ chức"),
      sort: (e) => e.organizationName,
      cell: (e) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{e.organizationName}</span>
          <span className="font-mono text-[11.5px] text-ink-2">
            MST {e.businessId ?? "—"}
          </span>
        </div>
      ),
    },
    {
      key: "model",
      header: tr("Mô hình"),
      hideBelow: "md",
      cell: (e) => (
        <span className="text-ink-2">
          {MODEL_LABEL[e.participationModel]}
          {e.payingParticipant ? tr(" · trả phí") : tr(" · miễn phí")}
        </span>
      ),
    },
    {
      key: "caps",
      header: tr("Năng lực"),
      cell: (e) => (
        <div className="flex flex-wrap gap-1">
          {e.capabilityRequests.map((c) => (
            <span
              key={c.id}
              title={c.status}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[11.5px]",
                c.status === "PENDING" && "bg-info-bg text-info",
                c.status === "APPROVED" && "bg-ok-bg text-ok",
                c.status === "REJECTED" &&
                  "bg-danger-bg text-danger line-through",
                c.status === "WITHDRAWN" && "bg-neutral-bg text-neutral",
              )}
            >
              {CAPABILITY_LABEL[c.code]}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "docs",
      header: tr("Tài liệu"),
      hideBelow: "lg",
      cell: (e) => (
        <span className="font-mono text-[12px]">{e.documents.length}</span>
      ),
    },
    {
      key: "created",
      header: tr("Nộp lúc"),
      sort: (e) => e.createdAt,
      cell: (e) => (
        <span className="flex flex-col">
          <span className="font-mono text-[12px]">
            {fmtDateTime(e.createdAt)}
          </span>
          <span className="text-[11.5px] text-ink-2">
            {fmtAgo(e.createdAt)}
          </span>
        </span>
      ),
    },
    {
      key: "stage",
      header: tr("Giai đoạn"),
      cell: (e) => <Status group="enrollment" value={e.onboardingStage} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={tr("Hồ sơ đăng ký doanh nghiệp")}
        description={tr(
          "Đăng ký không cấp quyền nghiệp vụ. Nền tảng xét hồ sơ, doanh nghiệp chọn gói và thanh toán, sau đó quản trị viên xác nhận kích hoạt dịch vụ theo điều kiện của hồ sơ.",
        )}
      />
      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label={tr("Giai đoạn")}
            className="-mx-1 flex gap-1 overflow-x-auto px-1"
          >
            {STAGES.map((s) => {
              const n = (q.data ?? []).filter((e) => match(e, s.key)).length;
              return (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={stage === s.key}
                  onClick={() => setStage(s.key)}
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-medium",
                    stage === s.key
                      ? "border-ink bg-ink text-canvas"
                      : "border-line bg-card hover:border-line-strong",
                  )}
                >
                  {s.label}{" "}
                  <span className="font-mono text-[11px] opacity-80">
                    {q.data ? n : "·"}
                  </span>
                </button>
              );
            })}
          </div>
          <Input
            aria-label={tr("Tìm hồ sơ")}
            placeholder={tr("Tên, MST hoặc email đại diện")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full sm:w-72"
          />
        </div>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable
            rows={q.data ? rows : undefined}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => q.refetch()}
            columns={columns}
            rowKey={(e) => e.id}
            href={(e) => `/admin/enterprises/${e.id}`}
            caption={tr("Danh sách hồ sơ đăng ký")}
            empty={
              <EmptyState title={tr("Không có hồ sơ ở giai đoạn này")}>
                {tr("Đổi bộ lọc giai đoạn hoặc xóa từ khóa tìm kiếm.")}
              </EmptyState>
            }
          />
        </div>
        <p className="text-[12px] text-ink-2">
          {tr("Nguồn:")}{" "}
          <span className="font-mono">GET /enterprise-enrollments</span>{" "}
          {tr(
            "trả toàn bộ danh sách; lọc và tìm kiếm thực hiện phía trình duyệt vì Backend chưa có tham số lọc/phân trang cho endpoint này.",
          )}
        </p>
      </PageBody>
    </>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale as useLedgerLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLedgerLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-enterprises">
      <PreviewScreen />
    </LedgerRouteScreen>
  );
}
