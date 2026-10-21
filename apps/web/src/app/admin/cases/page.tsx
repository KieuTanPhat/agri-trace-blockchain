"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import {
  caseCategoryLabels,
  caseSeverityLabels,
  caseStatusLabels,
  formatDateTime,
  type PlatformCase,
  type PlatformCasePage,
} from "@/lib/platform-governance";
import { errorMessage } from "@/lib/workspace";
import {
  DataTable,
  PageHeader,
  ReloadButton,
} from "@/components/manage";

export default function CasesPage() {
  const auth = useAuth();
  const userId = auth.user?.id;
  const isAdmin = ["SYSTEM_ADMIN", "PLATFORM_CASE_MANAGER"].includes(
    auth.user?.role.code ?? "",
  );
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [rows, setRows] = useState<PlatformCase[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);

  const load = useCallback(
    async (cursor?: string) => {
      const run = ++generation.current;
      setLoading(true);
      setError("");
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (severity) params.set("severity", severity);
      if (overdue) params.set("overdue", "true");
      if (cursor) params.set("cursor", cursor);
      try {
        const page = await request<PlatformCasePage>(
          `/platform-cases${params.size ? `?${params}` : ""}`,
        );
        if (run !== generation.current) return;
        setRows((current) =>
          cursor ? [...current, ...page.items] : page.items,
        );
        setNext(page.nextCursor);
      } catch (cause) {
        if (run === generation.current) setError(errorMessage(cause));
      } finally {
        if (run === generation.current) setLoading(false);
      }
    },
    [status, severity, overdue],
  );
  useEffect(() => {
    if (userId) void load();
  }, [load, userId]);

  return (
    <div className="manage-console">
      <PageHeader
        title="Sự cố và khiếu nại"
        description="Tiếp nhận, phân loại và giao hồ sơ cho doanh nghiệp sở hữu lô. Hồ sơ chỉ gửi yêu cầu và thông báo; việc thu hồi lô do doanh nghiệp thực hiện."
        back="/admin"
        action={
          isAdmin
            ? { href: "/admin/cases/new", label: "Tiếp nhận hồ sơ" }
            : undefined
        }
      />
      <section className="manage-section" aria-label="Danh sách hồ sơ">
        <div className="manage-filter-bar manage-audit-filters">
          <select
            className="manage-filter-select"
            aria-label="Lọc trạng thái"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Mọi trạng thái</option>
            {Object.entries(caseStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="manage-filter-select"
            aria-label="Lọc mức độ"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option value="">Mọi mức độ</option>
            {Object.entries(caseSeverityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="manage-date-field">
            <span>
              <input
                type="checkbox"
                checked={overdue}
                onChange={(event) => setOverdue(event.target.checked)}
              />{" "}
              Chỉ hồ sơ quá hạn phản hồi
            </span>
          </label>
          <ReloadButton onClick={() => void load()} />
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="manage-results-summary" role="status">
          {loading && !rows.length
            ? "Đang tải…"
            : `${rows.length} hồ sơ${next ? " (còn nữa)" : ""}`}
        </div>
        {(rows.length > 0 || (!loading && !error)) && (
          <DataTable
            label="Hồ sơ sự cố"
            rows={rows}
            rowKey={(row) => row.id}
            empty={{
              title: "Chưa có hồ sơ",
              description:
                "Hồ sơ mới xuất hiện tại đây sau khi được tiếp nhận.",
            }}
            columns={[
              {
                header: "Hồ sơ",
                cell: (row) => (
                  <>
                    <strong>
                      #{row.caseNumber} · {row.title}
                    </strong>
                    <small>
                      {caseCategoryLabels[row.category] ?? row.category}
                    </small>
                  </>
                ),
              },
              {
                header: "Mức độ",
                cell: (row) => caseSeverityLabels[row.severity] ?? row.severity,
              },
              {
                header: "Trạng thái",
                cell: (row) => (
                  <>
                    {caseStatusLabels[row.status] ?? row.status}
                    {row.overdue && <small>Quá hạn phản hồi</small>}
                  </>
                ),
              },
              {
                header: "Doanh nghiệp",
                cell: (row) => row.owner?.name ?? "Chưa giao",
              },
              {
                header: "Hạn phản hồi",
                cell: (row) =>
                  row.responseDueAt ? formatDateTime(row.responseDueAt) : "—",
              },
              {
                header: <span className="sr-only">Mở</span>,
                cell: (row) => (
                  <Link
                    className="manage-row-link"
                    href={`/admin/cases/${row.id}`}
                  >
                    Xem
                  </Link>
                ),
              },
            ]}
          />
        )}
        {next && (
          <button
            className="manage-section-footer"
            type="button"
            disabled={loading}
            onClick={() => void load(next)}
          >
            {loading ? "Đang tải…" : "Tải thêm"}
          </button>
        )}
      </section>
    </div>
  );
}
