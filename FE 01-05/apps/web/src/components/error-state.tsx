"use client";

import type { ReactNode } from "react";

type ErrorStateProps = {
  status: number;
  title: string;
  message: string;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
};

function toneForStatus(status: number) {
  if (status >= 500) return "error";
  if (status === 409 || status === 422) return "warning";
  if (status === 200) return "success";
  return "error";
}

function labelForStatus(status: number) {
  if (status === 200) return "Sẵn sàng";
  if (status === 403) return "403 Không có quyền";
  if (status === 404) return "404 Không tìm thấy";
  if (status === 409) return "409 Trạng thái xung đột";
  if (status === 422) return "422 Dữ liệu chưa hợp lệ";
  if (status === 503) return "503 Dịch vụ gián đoạn";
  return String(status);
}

export function ErrorState({ status, title, message, action, actionLabel, onAction }: ErrorStateProps) {
  const tone = toneForStatus(status);

  return (
    <section className={`panel state-box ${tone}`}>
      <p className="eyebrow">{labelForStatus(status)}</p>
      <h2>{title}</h2>
      <p className="muted">{message}</p>
      {action}
      {actionLabel && onAction ? <button className="button secondary" onClick={onAction}>{actionLabel}</button> : null}
    </section>
  );
}
