"use client";
import Link from "next/link";
import { useWorkspaceData, type Overview } from "@/lib/workspace";
import type { components } from "@/lib/generated/api";
import type { Catalog } from "@/lib/catalog";
import { cycleStates } from "@/components/workspace/production";
import { EmptyState, LoadState, PageHeader } from "@/components/manage";
import { EntityThumb } from "@/components/workspace/entity-thumb";
export default function CyclesPage() {
  const state =
      useWorkspaceData<components["schemas"]["CycleListDto"][]>(
        "/production-cycles",
      ),
    drafts = useWorkspaceData<{ items: { id: string; name: string; cycleCode: string; farmId: string; productId: string; version: number }[] }>("/production-cycles/drafts"),
    catalog = useWorkspaceData<Catalog>("/catalog"),
    overview = useWorkspaceData<Overview>("/enterprise-workspace");
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Vụ sản xuất"
        description="Tạo vụ nháp theo vùng và thửa đất; liên kết chuỗi trước khi ghi nhật ký hoặc thu hoạch."
        action={
          overview.data?.permissions.includes("production.write")
            ? { href: "/production-cycles/new", label: "Tạo vụ sản xuất" }
            : undefined
        }
      />
      <LoadState {...state} />
      <LoadState {...drafts} />
      <div className="manage-section manage-table-scroll">
        {(state.data?.length || drafts.data?.items.length) ? (
          <table className="manage-table">
            <thead>
              <tr>
                <th>Hình ảnh</th>
                <th>Mã vụ</th>
                <th>Sản phẩm</th>
                <th>Vùng sản xuất</th>
                <th>Trạng thái</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {drafts.data?.items.map((draft) => <tr key={draft.id}>
                <td data-label="Hình ảnh"><EntityThumb entityType="CYCLE_DRAFT" entityId={draft.id} kinds={["CYCLE_IMAGE"]} name={draft.name} /></td>
                <td data-label="Mã vụ"><strong>{draft.cycleCode}</strong><small>{draft.name}</small></td>
                <td data-label="Sản phẩm">{catalog.data?.products.find((product) => product.id === draft.productId)?.productName ?? "—"}</td>
                <td data-label="Vùng sản xuất">{catalog.data?.farms.find((farm) => farm.id === draft.farmId)?.name ?? "—"}</td>
                <td data-label="Trạng thái"><span className="workspace-badge">Nháp · chưa ghi nhật ký</span></td>
                <td data-label="Chi tiết"><Link className="text-link" href={`/production-cycles/drafts/${draft.id}`}>Liên kết chuỗi →</Link></td>
              </tr>)}
              {state.data?.map((c) => (
                <tr key={c.id}>
                  <td data-label="Hình ảnh">
                    <EntityThumb entityType="CYCLE" entityId={c.id} kinds={["CYCLE_IMAGE", "CARE_IMAGE", "HARVEST_IMAGE"]} name={c.cycleCode} />
                  </td>
                  <td data-label="Mã vụ">
                    <strong>{c.cycleCode}</strong>
                  </td>
                  <td data-label="Sản phẩm">{c.product.productName}</td>
                  <td data-label="Vùng sản xuất">
                    {c.farm.name}
                    <small>{c.plot?.name ?? "Chưa chọn thửa"}</small>
                  </td>
                  <td data-label="Trạng thái">
                    <span className="workspace-badge">
                      {cycleStates[c.currentState]}
                    </span>
                  </td>
                  <td data-label="Chi tiết">
                    <Link
                      className="text-link"
                      href={`/production-cycles/${c.id}`}
                    >
                      Xem vụ →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !state.loading &&
          !state.error && (
            <EmptyState
              title="Chưa có vụ sản xuất"
              description="Tạo vụ nháp từ vùng sản xuất và thửa đất của doanh nghiệp."
            />
          )
        )}
      </div>
    </div>
  );
}
