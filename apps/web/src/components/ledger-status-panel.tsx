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
      {(status.permissions.held > 0 ||
        status.openHolds > 0 ||
        status.delivery.deadLetter > 0) && (
        <p className="notice error" role="alert">
          Cần rà soát: {status.openHolds} lệnh giữ, {status.permissions.held}{" "}
          quyền bị giữ, {status.delivery.deadLetter} sự kiện lỗi vĩnh viễn.
          Hệ thống không báo xác minh cho các sự kiện này.
        </p>
      )}
    </section>
  );
}
