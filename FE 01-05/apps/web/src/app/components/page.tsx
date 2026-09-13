import { ActionPanel } from "@/components/action-panel";
import { ErrorState } from "@/components/error-state";
import { IconPalette, IconCheckCircle, IconAlertTriangle } from "@/components/icons";
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
        <div className="page-header-icon">
          <IconPalette size={22} />
        </div>
        <div>
          <p className="eyebrow">Thư viện giao diện</p>
          <h1>Bộ giao diện dùng chung</h1>
          <p className="muted">Kiểm tra badge, timeline, action panel và các trạng thái lỗi.</p>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panel-title">
            <div className="panel-title-left">
              <span className="panel-icon success"><IconCheckCircle size={16} /></span>
              <h2>Nhãn trạng thái</h2>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {states.map((state) => <StateBadge key={state} state={state} />)}
          </div>
        </div>

        <div className="grid two">
          <ActionPanel allowedCommands={batch.allowedCommands} batchId={batch.batchId} />
          <div className="panel">
            <div className="panel-title">
              <div className="panel-title-left">
                <span className="panel-icon warning"><IconAlertTriangle size={16} /></span>
                <h2>Một dòng timeline</h2>
              </div>
            </div>
            <TimelineItem event={batch.timeline[0]} />
          </div>
        </div>

        <div className="grid three">
          <LoadingState title="Đang tải dòng thời gian" />
          <ErrorState status={403} title="Không có quyền" message="Thao tác chưa được phép với người dùng hiện tại." />
          <ErrorState status={409} title="Trạng thái thay đổi" message="Lô đã cập nhật ở nơi khác, cần tải lại." />
          <ErrorState status={422} title="Dữ liệu chưa hợp lệ" message="Biểu mẫu thiếu trường bắt buộc hoặc sai định dạng." />
          <ErrorState status={503} title="Dịch vụ gián đoạn" message="Máy chủ hoặc bộ ghi chuỗi khối chưa sẵn sàng." />
        </div>
      </section>
    </>
  );
}
