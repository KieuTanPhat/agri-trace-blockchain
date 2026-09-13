import Link from "next/link";
import { ErrorState } from "@/components/error-state";

export default function NotFound() {
  return (
    <ErrorState
      status={404}
      title="Không tìm thấy trang"
      message="Đường dẫn này chưa có trong bản dựng hiện tại hoặc mã lô không tồn tại."
      action={<Link className="button secondary" href="/">Về dashboard</Link>}
    />
  );
}
