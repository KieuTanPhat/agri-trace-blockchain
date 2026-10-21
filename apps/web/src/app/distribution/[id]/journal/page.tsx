"use client";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useWorkspaceData, type Row } from "@/lib/workspace";
import { DataForm } from "@/components/data-form";
import { LoadState, PageHeader } from "@/components/manage";
export default function TransferJournalPage() {
  const { id } = useParams<{ id: string }>(),
    router = useRouter(),
    state = useWorkspaceData<{ record: Row }>(`/distribution/transfers/${id}`);
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        backLabel="Quay lại danh sách"
        title="Nhật ký giao nhận"
        description="Ghi nhận quan sát thủ công trong chặng vận chuyển. Dữ liệu này được phân biệt với bằng chứng cảm biến IoT."
        back={`/distribution/${id}`}
      />
      <LoadState {...state} />
      {state.data?.record.status === "IN_TRANSIT" ? (
        <DataForm
          title="Thêm ghi nhận"
          path={`/distribution/transfers/${id}/journal`}
          fields={[
            {
              name: "eventTime",
              label: "Thời điểm",
              type: "datetime-local",
              required: true,
            },
            {
              name: "note",
              label: "Nội dung quan sát",
              required: true,
              maxLength: 1000,
            },
            {
              name: "temperature",
              label: "Nhiệt độ (°C, nếu có)",
              pattern: "-?[0-9]{1,2}(\\.[0-9]{1,2})?",
            },
          ]}
          onSaved={() => router.push(`/distribution/${id}`)}
        />
      ) : (
        <p className="notice">
          Chỉ ghi nhật ký khi chặng giao nhận đang vận chuyển.
        </p>
      )}
    </div>
  );
}
