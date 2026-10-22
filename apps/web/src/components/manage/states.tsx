"use client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Inbox, RefreshCw } from "lucide-react";
/** Loading or error line for a page's data request. */
export function LoadState({
  loading,
  error,
}: {
  loading: boolean;
  error: string;
}) {
  return loading ? (
    <div className="panel manage-loading" role="status" aria-live="polite">
      <span className="manage-spinner" aria-hidden="true" />
      <span>Đang tải dữ liệu…</span>
      <div className="manage-skeleton" aria-hidden="true">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  ) : error ? (
    <p className="notice error" role="alert">
      {error}
    </p>
  ) : null;
}

export function EmptyState({
  title = "Chưa có dữ liệu",
  description = "Tạo bản ghi đầu tiên để bắt đầu quản lý truy xuất.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="manage-empty">
      <Inbox size={28} className="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function ReloadButton({ onClick }: { onClick(): void }) {
  return (
    <Button variant="outline"
      className="manage-reload"
      type="button"
      onClick={onClick}
    >
      <RefreshCw size={14} aria-hidden="true" /> Tải lại
    </Button>
  );
}

/** Command outcome; an unknown result keeps the original request for retry. */
export function CommandState({
  command,
}: {
  command: {
    pending: boolean;
    error: string;
    frozen: boolean;
    retrying?: boolean;
  };
}) {
  return (
    <>
      {command.retrying ? (
        <p className="notice" role="status">
          Chưa nhận được phản hồi. Hệ thống đang tự gửi lại đúng yêu cầu cũ để
          đối soát, không tạo bản ghi trùng…
        </p>
      ) : (
        command.error && (
          <p className="notice error" role="alert">
            {command.error}
          </p>
        )
      )}
      {command.frozen && !command.pending && (
        <p className="notice">
          Chưa xác nhận được kết quả. Bấm lại nút lưu để đối soát yêu cầu cũ;
          hệ thống không tạo yêu cầu mới.
        </p>
      )}
    </>
  );
}
