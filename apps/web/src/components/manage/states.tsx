"use client";
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
      <span className="manage-skeleton" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
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
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function ReloadButton({ onClick }: { onClick(): void }) {
  return (
    <button
      className="button secondary manage-reload"
      type="button"
      onClick={onClick}
    >
       Tải lại
    </button>
  );
}

/** Command outcome; an unknown result keeps the original request for retry. */
export function CommandState({
  command,
}: {
  command: { pending: boolean; error: string; frozen: boolean };
}) {
  return (
    <>
      {command.error && (
        <p className="notice error" role="alert">
          {command.error}
        </p>
      )}
      {command.frozen && !command.pending && (
        <p className="notice">
          Đang giữ yêu cầu cũ. Thử lại để đối soát; chưa tạo yêu cầu mới.
        </p>
      )}
    </>
  );
}
