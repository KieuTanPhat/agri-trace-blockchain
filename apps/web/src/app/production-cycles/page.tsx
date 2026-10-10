"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { request, getProductionCycles } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import type { ProductionCycleOption } from "@/lib/types";
import type { components } from "@/lib/generated/api";
import { sumQuantities } from "@/lib/quantity-display";
import { emptyCatalog, type Catalog } from "@/lib/catalog";
import { DataForm } from "@/components/data-form";
import { QrCodeCard } from "@/components/qr-code-card";
import { canWriteFarm } from "@/lib/permissions";
type Cycle = components["schemas"]["CycleDetailDto"];
const states: Record<string, string> = {
  CREATED: "Mới tạo",
  PLANTED: "Đã gieo trồng",
  GROWING: "Đang phát triển",
  COMPLETED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
};
export default function CyclesPage() {
  const { user } = useAuth();
  const canWrite = canWriteFarm(user?.role.code);
  const [cycles, setCycles] = useState<ProductionCycleOption[]>([]);
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Cycle | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [harvest, setHarvest] = useState<{
    lot: { id: string; lotCode: string };
    traceQr: { traceToken: string };
  } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const items = await getProductionCycles();
      setCycles(items);
      if (canWrite) setCatalog(await request<Catalog>("/catalog"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [canWrite]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let active = true;
    setDetail(null);
    if (selected)
      request<Cycle>("/production-cycles/" + selected)
        .then((d) => {
          if (active) setDetail(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected, revision]);
  const saved = () => {
    setNotice("Đã ghi nhận thành công.");
    setRevision((v) => v + 1);
    void load();
  };
  const active = detail && ["PLANTED", "GROWING"].includes(detail.currentState);
  return (
    <div className="grid">
      <section className="page-header">
        <h1>Quản lý vụ trồng</h1>
        <button
          className="button secondary"
          onClick={() => {
            void load();
            setRevision((v) => v + 1);
          }}
        >
          Tải lại dữ liệu
        </button>
      </section>
      {error && (
        <div className="notice error" role="alert">
          {error}{" "}
          <button
            className="button secondary"
            onClick={() => {
              void load();
              setRevision((v) => v + 1);
            }}
          >
            Thử lại
          </button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {canWrite && (
        <DataForm
          title="Tạo vụ trồng"
          path="/production-cycles"
          fields={[
            { name: "cycleCode", label: "Mã vụ trồng", required: true },
            {
              name: "farmId",
              label: "Nông trại",
              required: true,
              options: catalog.farms
                .filter((f) => f.status === "ACTIVE")
                .map((f) => ({ value: f.id, label: f.name })),
            },
            {
              name: "plotId",
              dependsOn: "farmId",
              label: "Thửa đất (thuộc nông trại đã chọn)",
              options: catalog.plots
                .filter((p) => p.status === "ACTIVE")
                .map((p) => ({
                  value: p.id,
                  parentValue: p.farmId,
                  label: (p.farm?.name ?? "") + " — " + p.name,
                })),
            },
            {
              name: "productId",
              label: "Sản phẩm",
              required: true,
              options: catalog.products
                .filter((p) => p.status === "ACTIVE")
                .map((p) => ({ value: p.id, label: p.productName })),
            },
            { name: "startDate", label: "Ngày bắt đầu", type: "date" },
            {
              name: "plannedHarvest",
              label: "Dự kiến thu hoạch",
              type: "date",
            },
            {
              name: "maxHarvestQuantity",
              label: "Tổng sản lượng tối đa",
              type: "number",
              min: 0.001,
              required: true,
            },
            { name: "harvestUnit", label: "Đơn vị thu hoạch", required: true },
            { name: "note", label: "Ghi chú" },
          ]}
          onSaved={saved}
        />
      )}
      <section className="panel">
        <h2>Danh sách vụ trồng</h2>
        {loading ? (
          <p>Đang tải…</p>
        ) : cycles.length === 0 ? (
          <p>Chưa có vụ trồng.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Mã vụ</th>
                  <th>Sản phẩm</th>
                  <th>Nông trại</th>
                  <th>Trạng thái</th>
                  <th>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.id}>
                    <td>{c.cycleCode}</td>
                    <td>{c.product.productName}</td>
                    <td>{c.farm.name}</td>
                    <td>{states[c.currentState]}</td>
                    <td>
                      <button
                        className="button secondary"
                        onClick={() => setSelected(c.id)}
                      >
                        Xem
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && !detail && !error && (
        <p role="status">Đang tải chi tiết vụ trồng…</p>
      )}
      {detail && (
        <section className="grid">
          <div className="panel">
            <h2>
              {detail.cycleCode} — {states[detail.currentState]}
            </h2>
            <p>
              {detail.farm.name} · {detail.product.productName} ·{" "}
              {detail.plot?.name ?? "Chưa chọn thửa"}
            </p>
            <p>
              {["TRANSPORTER", "RETAILER"].includes(user?.role.code ?? "")
                ? "Sản lượng các lần được phép xem:"
                : "Đã thu hoạch:"}{" "}
              {sumQuantities(detail.harvestEvents.map((item) => item.quantity))}{" "}
              / {detail.maxHarvestQuantity ?? "—"} {detail.harvestUnit}
            </p>
          </div>
          {canWrite && detail.currentState === "CREATED" && (
            <DataForm
              key={detail.id + "plant"}
              title="Ghi nhận gieo trồng"
              path={"/production-cycles/" + detail.id + "/plant"}
              extra={{ version: detail.version }}
              fields={[
                {
                  name: "plantedAt",
                  label: "Thời điểm gieo trồng",
                  type: "datetime-local",
                  required: true,
                },
              ]}
              onSaved={saved}
            />
          )}
          {canWrite && active && (
            <>
              <DataForm
                key={detail.id + "care"}
                title="Ghi nhận chăm sóc"
                path={"/production-cycles/" + detail.id + "/care"}
                extra={{ version: detail.version }}
                fields={[
                  { name: "careType", label: "Loại chăm sóc", required: true },
                  {
                    name: "eventTime",
                    label: "Thời điểm",
                    type: "datetime-local",
                    required: true,
                  },
                  { name: "materialName", label: "Vật tư" },
                  {
                    name: "quantity",
                    label: "Số lượng",
                    type: "number",
                    min: 0.001,
                  },
                  { name: "unit", label: "Đơn vị" },
                  { name: "method", label: "Phương pháp" },
                  { name: "note", label: "Ghi chú" },
                ]}
                onSaved={saved}
              />
              <DataForm
                key={detail.id + "harvest"}
                title="Ghi nhận thu hoạch"
                path={"/production-cycles/" + detail.id + "/harvests"}
                extra={{
                  unit:
                    detail.harvestUnit || detail.product.defaultUnit || "kg",
                }}
                fields={[
                  {
                    name: "harvestTime",
                    label: "Thời điểm thu hoạch",
                    type: "datetime-local",
                    required: true,
                  },
                  {
                    name: "quantity",
                    label: "Sản lượng (" + (detail.harvestUnit || "kg") + ")",
                    type: "number",
                    min: 0.001,
                    required: true,
                  },
                  { name: "lotCode", label: "Mã lô (để trống để tự sinh)" },
                  { name: "grade", label: "Phân hạng" },
                  { name: "qualityNote", label: "Ghi chú chất lượng" },
                  {
                    name: "expiryDate",
                    label: "Ngày hết hạn (nếu có)",
                    type: "date",
                  },
                ]}
                onSaved={(value) => {
                  setHarvest(value as typeof harvest);
                  saved();
                }}
              />
            </>
          )}
          <div className="panel">
            <h2>Lịch sử chăm sóc</h2>
            {detail.careRecords.length === 0 ? (
              <p>Chưa có ghi nhận.</p>
            ) : (
              detail.careRecords.map((c) => (
                <p key={c.id}>
                  {new Date(c.eventTime).toLocaleString("vi-VN")} — {c.careType}{" "}
                  {c.note && "— " + c.note}
                </p>
              ))
            )}
            <h2>Các lần thu hoạch</h2>
            {detail.harvestEvents.length === 0 ? (
              <p>Chưa thu hoạch.</p>
            ) : (
              detail.harvestEvents.map((h) => (
                <p key={h.id}>
                  {new Date(h.harvestTime).toLocaleString("vi-VN")} —{" "}
                  {h.quantity} {h.unit}{" "}
                  {h.lot && (
                    <Link href={"/lots/" + h.lot.id}>{h.lot.lotCode}</Link>
                  )}
                  {" — "}
                  {h.sensorWindow
                    ? `${h.sensorWindow.status === "NO_DATA" ? "Chưa có dữ liệu cảm biến" : "Đã chốt dữ liệu cảm biến"} (${h.sensorWindow.readingCount} mẫu)`
                    : "Dữ liệu cảm biến lịch sử chưa đối soát"}
                </p>
              ))
            )}
          </div>
        </section>
      )}
      {harvest && (
        <section className="panel" role="status">
          <h2>Đã tạo lô {harvest.lot.lotCode}</h2>
          <Link className="button" href={"/lots/" + harvest.lot.id}>
            Xem lô vừa thu hoạch
          </Link>
          <QrCodeCard
            value={
              (process.env.NEXT_PUBLIC_TRACE_BASE_URL ??
                window.location.origin + "/trace") +
              "/" +
              harvest.traceQr.traceToken
            }
          />
        </section>
      )}
    </div>
  );
}
