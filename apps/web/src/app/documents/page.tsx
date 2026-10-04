"use client";
import { useEffect, useState } from "react";
import { useRemote } from "@/lib/workspace-api";
import { useAuth } from "@/lib/auth-store";
import { MediaManager } from "@/components/media-manager";
import { RemoteState } from "@/components/workspace-controls";
export default function DocumentsPage() {
  const { user } = useAuth();
  useEffect(()=>{const q=new URLSearchParams(window.location.search);const type=q.get('targetType'),id=q.get('targetId');if(type&&id&&['LOT','PRODUCT','CERTIFICATE'].includes(type)){setType(type);setId(id);}},[]);
  const [type, setType] = useState("LOT"),
    [id, setId] = useState(""),
    [revision, setRevision] = useState(0);
  const lots = useRemote<
    { lotId: string; lotCode: string; farmOrg: { organizationId: string } }[]
  >("/lots", revision);
  const options = useRemote<{ products: { id: string; name: string }[] }>(
    "/reports/options",
    revision,
  );
  const certs = useRemote<{ id: string; type: string; issuer: string }[]>(
    "/certificates",
    revision,
  );
  const choices =
    type === "LOT"
      ? lots.data?.map((l) => ({ id: l.lotId, name: l.lotCode }))
      : type === "PRODUCT"
        ? options.data?.products
        : certs.data?.map((c) => ({
            id: c.id,
            name: c.type + " · " + c.issuer,
          }));
  const canWrite =
    user?.role.code === "SYSTEM_ADMIN" ||
    (user?.role.code === "FARM_STAFF" && type !== "PRODUCT");
  return (
    <div className="workspace-page">
      <header className="page-header">
        <div>
          <h1>Quản lý ảnh và tài liệu</h1>
          <p>Chọn đối tượng để xem tài liệu trong phạm vi quyền truy cập.</p>
        </div>
      </header>
      <section className="panel workspace-toolbar">
        <label>
          Loại đối tượng
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setId("");
            }}
          >
            <option value="LOT">Lô hàng</option>
            <option value="PRODUCT">Sản phẩm</option>
            <option value="CERTIFICATE">Chứng nhận</option>
          </select>
        </label>
        <label>
          Đối tượng
          <select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Chọn đối tượng</option>
            {choices?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      <RemoteState
        loading={lots.loading || options.loading || certs.loading}
        error={lots.error || options.error || certs.error}
        empty={choices?.length === 0}
        retry={() => setRevision((v) => v + 1)}
      />
      {id && (
        <MediaManager
          key={type + id}
          targetType={type}
          targetId={id}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}
