"use client";
import { useState } from "react";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { useLedgerInfiniteQuery } from "@/lib/ledger/data";
import {
  enterpriseAudit,
  type EnterpriseAuditEntry,
  type EnterpriseAuditFilters,
} from "@/lib/ledger/enterprise-audit-api";
import { fmtDateTime } from "@/lib/ledger/format";
import { t } from "@/lib/ledger/i18n";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { FilterSelect } from "@/components/ledger/kit/filters";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  PageBody,
} from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";

const ACTIONS: Record<string, string> = {
  CREATE_PRODUCTION_CYCLE: "Tạo vụ sản xuất",
  PLANT_PRODUCTION_CYCLE: "Xuống giống",
  RECORD_CARE: "Ghi nhật ký chăm sóc",
  RECORD_SENSOR: "Ghi nhận cảm biến",
  RECORD_HARVEST: "Thu hoạch và tạo lô",
  CLOSE_PRODUCTION_CYCLE: "Kết thúc vụ",
  CANCEL_PRODUCTION_CYCLE: "Hủy vụ",
  EW_CREATE_CYCLE_DRAFT: "Lập vụ nháp",
  EW_LINK_CYCLE_DRAFT: "Đưa vụ nháp vào chuỗi",
  EW_SET_CYCLE_STAFF: "Phân công vụ sản xuất",
  EW_CREATE_SITE: "Thêm cơ sở",
  EW_UPDATE_SITE: "Cập nhật cơ sở",
  EW_CREATE_VEHICLE: "Thêm phương tiện",
  EW_UPDATE_VEHICLE: "Cập nhật phương tiện",
  EW_CREATE_EXTERNAL_PARTNER: "Thêm đối tác ngoài hệ thống",
  EW_INVITE_PARTNER: "Mời đối tác",
  EW_RESOLVE_PARTNER: "Phản hồi lời mời đối tác",
  DIST_CREATE: "Tạo phiếu giao nhận",
  DIST_SIGN: "Ký phiếu giao nhận",
  DIST_RECEIPT: "Xác nhận nhận hàng",
  DIST_CANCEL: "Hủy phiếu giao nhận",
  DIST_OBSERVE: "Ghi nhật ký giao nhận",
  DIST_PHOTOS: "Bổ sung ảnh giao nhận",
  DIST_RETURN: "Lập phiếu trả hàng",
  DIST_RETURN_SIGN: "Ký trả hàng",
  EW_ALLOCATE: "Phân bổ lô hàng",
  EW_QUARANTINE: "Cách ly lô hàng",
  EW_DISPOSITION: "Xử lý lô hàng",
  PASSWORD_CHANGED: "Đổi mật khẩu",
  STAFF_PASSWORD_RESET: "Khôi phục mật khẩu",
  USER_LOGIN_LOCKED: "Khóa đăng nhập do nhập sai",
  USER_SESSIONS_REVOKED_SELF: "Thu hồi phiên đăng nhập",
};
export default function EnterpriseAudit() {
  const { primary, can, isLoading, error: accessError } = useWorkspaceAccess();
  const allowed = primary && can("members.manage");
  const [q, setQ] = useState(""),
    [action, setAction] = useState(""),
    [outcome, setOutcome] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [error, setError] = useState("");
  const [filters, setFilters] = useState<EnterpriseAuditFilters>({});
  const history = useLedgerInfiniteQuery({
    queryKey: ["enterprise-staff-audit", filters],
    enabled: allowed,
    queryFn: ({ pageParam }) => enterpriseAudit(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = history.data?.pages.flatMap((page) => page.items) ?? [];
  const columns: Column<EnterpriseAuditEntry>[] = [
    {
      key: "time",
      header: t("Thời gian"),
      cell: (row) => fmtDateTime(row.occurredAt),
    },
    {
      key: "employee",
      header: t("Nhân viên"),
      cell: (row) => (
        <div>
          <div className="font-medium">{row.employee.fullName}</div>
          <div className="text-[12px] text-ink-2">{row.employee.email}</div>
        </div>
      ),
    },
    {
      key: "action",
      header: t("Thao tác"),
      cell: (row) =>
        ACTIONS[row.action] ? t(ACTIONS[row.action]) : row.action,
    },
    {
      key: "category",
      header: t("Nhóm"),
      cell: (row) => t(row.category === "ACCOUNT" ? "Tài khoản" : "Tác nghiệp"),
    },
    {
      key: "outcome",
      header: t("Kết quả"),
      cell: (row) => <Status group="outcome" value={row.outcome} />,
    },
  ];
  if (isLoading) return <LoadingRows />;
  if (accessError) return <ErrorState error={accessError} />;
  if (!allowed) return <EmptyState title={t("Không có quyền truy cập")} />;
  return (
    <>
      <PageHeader
        title={t("Hoạt động nhân viên")}
        description={t(
          "Chỉ xem hoạt động đã được ghi nhận của nhân viên thuộc doanh nghiệp bạn.",
        )}
        actions={
          <Button
            variant="outline"
            disabled={history.isFetching}
            onClick={() => void history.refetch()}
          >
            {t("Tải lại")}
          </Button>
        }
      />
      <PageBody>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (from && to && from > to) {
              setError(t("Ngày kết thúc phải từ ngày bắt đầu trở đi."));
              return;
            }
            setError("");
            setFilters({
              q: q.trim() || undefined,
              action: action || undefined,
              outcome: outcome || undefined,
              from: from
                ? new Date(from + "T00:00:00").toISOString()
                : undefined,
              to: to ? new Date(to + "T23:59:59.999").toISOString() : undefined,
            });
          }}
        >
          <label className="grid gap-1 text-[13px]">
            {t("Nhân viên")}
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              maxLength={100}
              placeholder={t("Tên hoặc email nhân viên")}
              className="sm:w-64"
            />
          </label>
          <FilterSelect
            label={t("Thao tác")}
            value={action}
            onChange={setAction}
            options={Object.entries(ACTIONS).map(([value, label]) => ({
              value,
              label: t(label),
            }))}
          />
          <FilterSelect
            label={t("Kết quả")}
            value={outcome}
            onChange={setOutcome}
            options={[
              { value: "SUCCESS", label: t("Thành công") },
              { value: "DENIED", label: t("Bị từ chối") },
              { value: "FAILED", label: t("Lỗi") },
            ]}
          />
          <label className="grid gap-1 text-[13px]">
            {t("Từ ngày")}
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-[13px]">
            {t("Đến ngày")}
            <Input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <Button type="submit">{t("Áp dụng")}</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQ("");
              setAction("");
              setOutcome("");
              setFrom("");
              setTo("");
              setFilters({});
              setError("");
            }}
          >
            {t("Xóa lọc")}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          pageSize={null}
          loading={history.isPending}
          error={history.error}
          onRetry={() => void history.refetch()}
          empty={
            <EmptyState title={t("Chưa có hoạt động nhân viên")}>
              {t("Không có bản ghi phù hợp với bộ lọc hiện tại.")}
            </EmptyState>
          }
        />
        {history.hasNextPage && (
          <Button
            variant="outline"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {t("Xem thêm")}
          </Button>
        )}
        <p className="text-[12px] text-ink-2">
          {t(
            "Lịch sử chỉ đọc. Bao gồm thao tác nghiệp vụ đã lưu và sự kiện tài khoản đã được ghi nhận; không bao gồm mọi lượt xem hoặc thao tác chưa gửi lên máy chủ.",
          )}
        </p>
      </PageBody>
    </>
  );
}
