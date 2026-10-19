"use client";
import Link from "next/link";
import {
  useWorkspaceData,
  textValue,
  type Row,
  type Overview,
} from "@/lib/workspace";
import {
  EmptyState,
  LoadState,
  PageHeader,
  StatusBadge,
} from "@/components/manage";
export default function DistributionPage() {
  const state = useWorkspaceData<{ items: Row[] }>("/distribution/transfers"),
    overview = useWorkspaceData<Overview>("/enterprise-workspace");
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Phân phối & giao nhận"
        description="Theo dõi từng chặng từ lô nguồn. Mọi bên xác nhận trước khi chuyển trách nhiệm giữ hàng."
        action={
          overview.data?.permissions.includes("distribution.write")
            ? { href: "/distribution/new", label: "Tạo giao nhận" }
            : undefined
        }
      />
      <div className="workspace-actions">
        <Link className="button secondary" href="/enterprise/reports">
          Đối soát số lượng
        </Link>
        <Link className="text-link" href="/enterprise/signing">
          Khóa ký bàn giao →
        </Link>
      </div>
      <LoadState {...state} />
      <div className="manage-section manage-table-scroll">
        {state.data?.items.length ? (
          <table className="manage-table">
            <thead>
              <tr>
                <th>Giao nhận</th>
                <th>Bên giao → Bên nhận</th>
                <th>Đơn vị vận chuyển</th>
                <th>Lượng hàng</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {state.data.items.map((t) => (
                <tr key={String(t.id)}>
                  <td data-label="Giao nhận">
                    <Link className="text-link" href={`/distribution/${t.id}`}>
                      GN-{String(t.id).slice(0, 8).toUpperCase()}
                    </Link>
                    <small>
                      {new Date(String(t.createdAt)).toLocaleDateString(
                        "vi-VN",
                      )}
                    </small>
                  </td>
                  <td data-label="Bên giao → Bên nhận">
                    {textValue(t.senderName)}
                    <small>→ {textValue(t.receiverName)}</small>
                  </td>
                  <td data-label="Đơn vị vận chuyển">{textValue(t.carrierName)}</td>
                  <td data-label="Lượng hàng">
                    {(t.lines as Row[]).map((l) => (
                      <span key={String(l.id)}>
                        {textValue(l.quantity)} {textValue(l.unit)}
                        <small>{textValue(l.lotCode)}</small>
                      </span>
                    ))}
                  </td>
                  <td data-label="Trạng thái">
                    <StatusBadge value={String(t.status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !state.loading &&
          !state.error && (
            <EmptyState
              title="Chưa có giao nhận"
              description="Bắt đầu bằng liên kết đối tác và chọn lượng hàng cần giao từ lô nguồn."
            />
          )
        )}
      </div>
    </div>
  );
}
