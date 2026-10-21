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
