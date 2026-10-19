"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import {
  auditActionLabels,
  downloadText,
  formatDateTime,
  type AuditExport,
  type AuditPage,
  type AuditVerification,
} from "@/lib/platform-governance";
import { errorMessage } from "@/lib/workspace";
import { EmptyState, PageHeader, ReloadButton } from "@/components/manage";

type Filters = {
  action: string;
  from: string;
  to: string;
  subjectType: string;
};
const empty: Filters = { action: "", from: "", to: "", subjectType: "" };
const subjectTypes = [
  ["USER", "Tài khoản"],
  ["ORGANIZATION", "Tổ chức"],
  ["ENTERPRISE_ENROLLMENT", "Hồ sơ doanh nghiệp"],
  ["ENTERPRISE_CONNECTION", "Kết nối peer"],
  ["SCOPED_ROLE_GRANT", "Vai trò được cấp"],
  ["PLATFORM_APPROVAL", "Đề xuất phê duyệt"],
];

function query(filters: Filters, cursor?: string) {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.subjectType) params.set("subjectType", filters.subjectType);
  if (filters.from) params.set("from", new Date(filters.from).toISOString());
  if (filters.to) params.set("to", new Date(filters.to).toISOString());
  if (cursor) params.set("cursor", cursor);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export default function AuditLogPage() {
  const auth = useAuth();
  const [filters, setFilters] = useState<Filters>(empty);
  const [applied, setApplied] = useState<Filters>(empty);
  const [items, setItems] = useState<AuditPage["items"]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState<AuditVerification | null>(
    null,
  );
  const [busy, setBusy] = useState("");
  const generation = useRef(0);
  const userId = auth.user?.id;

  const load = useCallback(async (filter: Filters, cursor?: string) => {
    const run = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const page = await request<AuditPage>(
        `/platform-audit${query(filter, cursor)}`,
      );
      if (run !== generation.current) return;
      setItems((current) =>
        cursor ? [...current, ...page.items] : page.items,
      );
      setNext(page.nextCursor);
    } catch (cause) {
      if (run === generation.current) setError(errorMessage(cause));
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    void load(applied);
  }, [applied, load, userId]);
  useEffect(() => {
    if (!userId) return;
    request<string[]>("/platform-audit/actions")
      .then(setActions)
      .catch(() => setActions([]));
  }, [userId]);

  async function verify() {
    setBusy("verify");
    setError("");
    try {
      setVerification(
        await request<AuditVerification>("/platform-audit/verify"),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }
  async function exportCsv() {
    setBusy("export");
    setError("");
    try {
      const file = await request<AuditExport>(
        `/platform-audit/export${query(applied)}`,
      );
      downloadText(file.filename, "﻿" + file.csv, "text/csv;charset=utf-8");
      if (file.truncated)
        setError(
          `Tệp chỉ gồm ${file.limit} bản ghi mới nhất. Thu hẹp bộ lọc để xuất phần còn lại.`,
        );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="manage-console">
      <PageHeader
        title="Nhật ký kiểm toán nền tảng"
        description="Mọi thao tác quản trị được ghi cùng giao dịch, nối băm và không thể sửa hay xóa. Chỉ xem."
        back="/admin"
      />
      <section className="manage-section" aria-label="Bộ lọc nhật ký">
        <form
          className="manage-filter-bar manage-audit-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(filters);
          }}
        >
          <select
            className="manage-filter-select"
            aria-label="Lọc theo hành động"
            value={filters.action}
            onChange={(event) =>
              setFilters({ ...filters, action: event.target.value })
            }
          >
            <option value="">Mọi hành động</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {auditActionLabels[action] ?? action}
              </option>
            ))}
          </select>
          <select
            className="manage-filter-select"
            aria-label="Lọc theo loại đối tượng"
            value={filters.subjectType}
            onChange={(event) =>
              setFilters({ ...filters, subjectType: event.target.value })
            }
          >
            <option value="">Mọi đối tượng</option>
            {subjectTypes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="manage-date-field">
            <span>Từ</span>
            <input
              type="datetime-local"
              className="manage-filter-select"
              value={filters.from}
              onChange={(event) =>
                setFilters({ ...filters, from: event.target.value })
              }
            />
          </label>
          <label className="manage-date-field">
            <span>Đến</span>
            <input
              type="datetime-local"
              className="manage-filter-select"
              value={filters.to}
              onChange={(event) =>
                setFilters({ ...filters, to: event.target.value })
              }
            />
          </label>
          <button className="button" type="submit">
            Lọc
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              setFilters(empty);
              setApplied(empty);
            }}
          >
            Xóa lọc
          </button>
          <ReloadButton onClick={() => void load(applied)} />
        </form>
        <div className="manage-audit-tools">
          <button
            className="button secondary"
            type="button"
            disabled={busy !== ""}
            onClick={() => void verify()}
          >

            {busy === "verify" ? "Đang kiểm tra…" : "Kiểm tra toàn vẹn chuỗi"}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={busy !== ""}
            onClick={() => void exportCsv()}
          >

            {busy === "export" ? "Đang xuất…" : "Xuất CSV (theo bộ lọc)"}
          </button>
        </div>
        {verification && (
          <p
            className={verification.ok ? "notice" : "notice error"}
            role={verification.ok ? "status" : "alert"}
          >
            {verification.ok
              ? `Chuỗi toàn vẹn: ${verification.checked} bản ghi, đầu chuỗi #${verification.headSequence ?? "—"}.`
              : `Phát hiện bất thường tại bản ghi #${verification.firstInvalid?.sequence}: ${verification.firstInvalid?.reason}.`}
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <div className="manage-results-summary" role="status">
          {loading && !items.length
            ? "Đang tải nhật ký…"
            : `${items.length} bản ghi${next ? " (còn nữa)" : ""}`}
        </div>
        {items.length ? (
          <div className="manage-table-scroll">
            <table className="manage-table">
              <thead>
                <tr>
                  <th scope="col">Thời điểm</th>
                  <th scope="col">Người thực hiện</th>
                  <th scope="col">Hành động</th>
                  <th scope="col">Đối tượng</th>
                  <th scope="col">Lý do / chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="Thời điểm">
                      <strong>#{entry.sequence}</strong>
                      <small>{formatDateTime(entry.occurredAt)}</small>
                    </td>
                    <td data-label="Người thực hiện">
                      {entry.actor ? (
                        <>
                          <strong>{entry.actor.fullName}</strong>
                          <small>{entry.actor.email}</small>
                        </>
                      ) : (
                        <strong>Hệ thống</strong>
                      )}
                    </td>
                    <td data-label="Hành động">
                      {auditActionLabels[entry.action] ?? entry.action}
                      {entry.outcome !== "SUCCESS" && (
                        <small>{entry.outcome}</small>
                      )}
                    </td>
                    <td data-label="Đối tượng">
                      {entry.organization?.name ?? entry.subjectType}
                      <small>{entry.subjectId}</small>
                    </td>
                    <td data-label="Lý do / chi tiết">
                      {entry.reason ?? "—"}
                      <details>
                        <summary>Chi tiết kỹ thuật</summary>
                        <pre className="manage-json">
                          {JSON.stringify(
                            {
                              details: entry.details,
                              requestId: entry.requestId,
                              idempotencyKey: entry.idempotencyKey,
                              entryHash: entry.entryHash,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !loading &&
          !error && (
            <EmptyState
              title="Chưa có bản ghi phù hợp"
              description="Thử bộ lọc khác hoặc xóa bộ lọc."
            />
          )
        )}
        {next && (
          <button
            className="manage-section-footer"
            type="button"
            disabled={loading}
            onClick={() => void load(applied, next)}
          >
            {loading ? "Đang tải…" : "Tải thêm bản ghi cũ hơn"}
          </button>
        )}
      </section>
    </div>
  );
}
