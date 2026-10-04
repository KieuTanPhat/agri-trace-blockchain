"use client";
export function RemoteState({
  loading,
  error,
  empty,
  retry,
}: {
  loading: boolean;
  error?: string;
  empty?: boolean;
  retry: () => void;
}) {
  if (loading) return <p role="status">Đang tải dữ liệu…</p>;
  if (error)
    return (
      <div className="notice error" role="alert">
        {error}{" "}
        <button className="button secondary" onClick={retry}>
          Thử lại
        </button>
      </div>
    );
  if (empty)
    return <p className="notice">Không có dữ liệu phù hợp với bộ lọc.</p>;
  return null;
}
export function Pager({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (p: number) => void;
}) {
  return (
    <nav className="workspace-toolbar" aria-label="Phân trang">
      <button
        className="button secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Trước
      </button>
      <span>
        Trang {page} / {Math.max(1, Math.ceil(total / size))} · {total} bản ghi
      </span>
      <button
        className="button secondary"
        disabled={page * size >= total}
        onClick={() => onChange(page + 1)}
      >
        Sau
      </button>
    </nav>
  );
}
export function DateFilters({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (s: string) => void;
  setTo: (s: string) => void;
}) {
  return (
    <>
      <label>
        Từ thời điểm
        <input
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label>
        Đến thời điểm
        <input
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
    </>
  );
}
export function isoDate(value: string) {
  return value ? new Date(value).toISOString() : "";
}
