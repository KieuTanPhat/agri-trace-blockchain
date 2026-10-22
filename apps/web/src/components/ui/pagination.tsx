import { ChevronDown } from "lucide-react";
import { Button } from "./button";

/** Cursor pagination retains the existing API's append semantics. */
export function CursorPagination({ count, loading, onMore }: { count: number; loading: boolean; onMore(): void }) {
  return <nav className="workspace-pagination" aria-label="Phân trang">
    <span>Đã hiển thị {count} bản ghi</span>
    <Button type="button" variant="outline" disabled={loading} onClick={onMore}>
      {loading ? "Đang tải…" : "Tải thêm bản ghi cũ hơn"}<ChevronDown size={16} aria-hidden="true" />
    </Button>
  </nav>;
}
