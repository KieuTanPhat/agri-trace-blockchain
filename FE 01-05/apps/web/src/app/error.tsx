"use client";

import { ErrorState } from "@/components/error-state";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="vi">
      <body>
        <main className="content">
          <ErrorState
            status={503}
            title="Ứng dụng gặp lỗi"
            message={error.message || "Vui lòng thử tải lại màn hình."}
            actionLabel="Thử lại"
            onAction={reset}
          />
        </main>
      </body>
    </html>
  );
}
