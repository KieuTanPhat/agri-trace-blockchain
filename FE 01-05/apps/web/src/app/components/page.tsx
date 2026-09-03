import { ActionPanel } from "@/components/action-panel";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { StateBadge } from "@/components/state-badge";
import { TimelineItem } from "@/components/timeline-item";
import { mockBatches } from "@/lib/mock-api";

const states = ["CREATED", "PLANTED", "HARVESTED", "IN_TRANSPORT", "FOR_SALE", "DAMAGED", "REJECTED", "verified", "pending", "mismatch"];

export default function ComponentsPage() {
  const batch = mockBatches[0];

  return (
    <>
      <section className="page-header">
        <div>
          <p className="eyebrow">Thư viện giao diện</p>
          <h1>Bộ giao diện dùng chung</h1>
          <p className="muted">Khu vực kiểm tra badge, timeline, action panel và các trạng thái lỗi thường gặp.</p>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panel-title"><h2>Nhãn trạng thái</h2></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {states.map((state) => <StateBadge key={state} state={state} />)}
          </div>
        </div>

        <div className="grid two">
          <ActionPanel allowedCommands={batch.allowedCommands} batchId={batch.batchId} />
          <div className="panel">
            <div className="panel-title"><h2>Một dòng timeline</h2></div>
            <TimelineItem event={batch.timeline[0]} />
          </div>
        </div>

        <div className="grid three">
          <LoadingState title="Đang tải dòng thời gian" />
          <ErrorState status={403} title="Không có quyền" message="Thao tác này chưa được phép với người dùng hiện tại." />
          <ErrorState status={409} title="Trạng thái đã thay đổi" message="Lô đã được cập nhật ở nơi khác, cần tải lại trước khi thao tác." />
          <ErrorState status={422} title="Dữ liệu chưa hợp lệ" message="Biểu mẫu đang thiếu trường bắt buộc hoặc sai định dạng." />
          <ErrorState status={503} title="Dịch vụ tạm gián đoạn" message="Máy chủ hoặc bộ ghi giao dịch chuỗi khối chưa sẵn sàng." />
        </div>
      </section>
    </>
  );
}
