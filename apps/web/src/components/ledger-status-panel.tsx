"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/api-client";
import type { components } from "@/lib/generated/api";

type Status = components["schemas"]["LedgerStatusDto"];

const profiles: Record<string, string> = {
  RELEASE_A: "Chưa dùng Fabric theo chuỗi (cấu hình chung của nền tảng)",
  SERVICE: "AgriTrace vận hành mạng và ký giao dịch",
  MANAGED_ORG: "Tổ chức riêng trên Fabric do AgriTrace vận hành hộ",
  SELF_MANAGED_ORG: "Tổ chức tự quản: peer và khóa do doanh nghiệp giữ",
};
const bindings: Record<string, string> = {
  ACTIVE: "Đang hoạt động",
  PAUSED: "Tạm dừng",
  PENDING: "Chờ kích hoạt",
};

const SLOW_BACKLOG_SECONDS = 15 * 60;

/** Operational problems a business user should see, derived only from the
 * non-secret observation the API projects. A missing heartbeat is a problem,
 * never silence. */
export function workerIssues(status: Status): string[] {
  const issues: string[] = [];
  const { worker, delivery } = status;
  if (worker.heartbeatStale)
    issues.push(
      worker.lastHealthyAt
        ? `Worker ledger không báo hoạt động từ ${new Date(worker.lastHealthyAt).toLocaleString("vi-VN")}.`
        : "Worker ledger chưa báo hoạt động cho kết nối này.",
    );
  if (worker.certificateExpired)
    issues.push("Chứng thư của tài khoản ghi ledger đã hết hạn.");
  if (worker.lastErrorCode)
    issues.push(`Lỗi kết nối gần nhất: ${worker.lastErrorCode}.`);
  if (status.failedControlJobs > 0)
    issues.push(
      `${status.failedControlJobs} tác vụ điều khiển ledger đã thất bại${
        status.lastControlFailureAt
          ? ` (gần nhất ${new Date(status.lastControlFailureAt).toLocaleString("vi-VN")})`
          : ""
      }.`,
    );
  if (
    delivery.pendingAgeSeconds !== null &&
    delivery.pendingAgeSeconds > SLOW_BACKLOG_SECONDS
  )
    issues.push(
      `Sự kiện chờ gửi lâu nhất đã ${Math.floor(delivery.pendingAgeSeconds / 60)} phút.`,
    );
  return issues;
}

/** Read-only view of how this chain reaches the ledger. Business users never
 * choose a channel or MSP; this panel only reports state and backlog. */
export function LedgerStatusPanel({ chainId }: { chainId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setStatus(null);
    setError("");
    request<Status>(`/supply-chains/${chainId}/ledger-status`)
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [chainId]);
  if (error)
    return (
      <p className="notice error" role="alert">
        {error}
      </p>
    );
  if (!status) return <p role="status">Đang tải trạng thái ledger…</p>;
  const backlog = status.delivery.pending + status.delivery.retry;
  const operational =
    status.profile === "RELEASE_A" ? [] : workerIssues(status);
  return (
    <section className="panel" aria-label="Trạng thái ledger">
      <h2>Ledger</h2>
      <p>{profiles[status.profile] ?? status.profile}</p>
      {status.bindingStatus && (
        <p>
          Kết nối: {bindings[status.bindingStatus] ?? status.bindingStatus}
          {status.channelId ? ` · kênh ${status.channelId}` : ""}
        </p>
      )}
      {status.profile !== "RELEASE_A" && (
        <ul>
          <li>Quyền đã xác nhận trên ledger: {status.permissions.active}</li>
          {status.permissions.pending > 0 && (
            <li>Quyền chờ xác nhận: {status.permissions.pending}</li>
          )}
          {status.permissions.revoking > 0 && (
            <li>Quyền đang thu hồi: {status.permissions.revoking}</li>
          )}
          <li>Sự kiện đã xác nhận: {status.delivery.completed}</li>
          {backlog > 0 && (
            <li>
              Sự kiện đang chờ gửi: {backlog}
              {status.delivery.oldestPendingAt
                ? ` (cũ nhất ${new Date(status.delivery.oldestPendingAt).toLocaleString("vi-VN")})`
                : ""}
            </li>
          )}
        </ul>
      )}
      {operational.length > 0 && (
        <div className="notice error" role="alert">
          <strong>Vận hành ledger cần chú ý:</strong>
          <ul>
            {operational.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {(status.permissions.held > 0 ||
        status.openHolds > 0 ||
        status.delivery.deadLetter > 0) && (
        <p className="notice error" role="alert">
          Cần rà soát: {status.openHolds} lệnh giữ, {status.permissions.held}{" "}
          quyền bị giữ, {status.delivery.deadLetter} sự kiện lỗi vĩnh viễn. Hệ
          thống không báo xác minh cho các sự kiện này.
        </p>
      )}
    </section>
  );
}
