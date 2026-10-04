"use client";
import Link from "next/link";
import { useState } from "react";
import { useRemote, queryString, downloadCsv } from "@/lib/workspace-api";
import {
  DateFilters,
  isoDate,
  RemoteState,
} from "@/components/workspace-controls";
const metrics = {
  harvested: "Thu hoạch",
  shipped: "Xuất giao",
  received: "Thực nhận",
  damaged: "Hư hỏng",
  rejected: "Từ chối",
};
type Metric = keyof typeof metrics;
type Amounts = Record<Metric, number> & { unit: string };
type Row = Amounts & {
  lotId: string;
  lotCode: string;
  product: string;
  organization: string;
};
export default function ReportsPage() {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [productId, setProduct] = useState(""),
    [organizationId, setOrg] = useState("");
  const [filter, setFilter] = useState(""),
    [revision, setRevision] = useState(0),
    [detail, setDetail] = useState<{metric:Metric;unit:string} | null>(null);
  const options = useRemote<{
    products: { id: string; name: string }[];
    organizations: { id: string; name: string }[];
  }>("/reports/options", revision);
  const { data, loading, error } = useRemote<{
    rows: Row[];
    totals: Amounts[];
  }>("/reports?" + filter, revision);
  const dirty=queryString({from:isoDate(from),to:isoDate(to),productId,organizationId})!==filter;
  const keys = Object.keys(metrics) as Metric[];
  const rows = data?.rows.filter((r) => !detail || (r[detail.metric] > 0 && r.unit===detail.unit)) ?? [];
  return (
    <div className="workspace-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Hoạt động trong phạm vi truy cập</p>
          <h1>Báo cáo nghiệp vụ</h1>
          <p>
            Số liệu theo thời điểm thu hoạch, xuất giao, giao nhận và ghi nhận
            hư hỏng. Tổng được tách riêng theo đơn vị.
          </p>
        </div>
      </header>
      <form
        className="panel workspace-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setDetail(null);
          setFilter(
            queryString({
              from: isoDate(from),
              to: isoDate(to),
              productId,
              organizationId,
            }),
          );
          setRevision((v) => v + 1);
        }}
      >
        <DateFilters {...{ from, to, setFrom, setTo }} />
        <label>
          Sản phẩm
          <select
            value={productId}
            onChange={(e) => setProduct(e.target.value)}
          >
            <option value="">Tất cả trong quyền truy cập</option>
            {options.data?.products.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tổ chức
          <select
            value={organizationId}
            onChange={(e) => setOrg(e.target.value)}
          >
            <option value="">Tất cả trong quyền truy cập</option>
            {options.data?.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button" disabled={loading}>
          Áp dụng bộ lọc
        </button>
      </form>
      <RemoteState
        loading={options.loading}
        error={options.error}
        retry={() => setRevision((v) => v + 1)}
      />
      <RemoteState
        loading={loading}
        error={error}
        empty={data?.rows.length === 0}
        retry={() => setRevision((v) => v + 1)}
      />
      {data && !loading && !error && (
        <>
          <section className="panel">
            <h2>Sản lượng theo đơn vị</h2>
            <p>Nhấn số liệu để mở danh sách lô tương ứng.</p>
            {data.totals.map((t) => (
              <div key={t.unit}>
                <h3>{t.unit}</h3>
                <div className="metric-grid">
                  {keys.map((k) => (
                    <button
                      className="metric-card"
                      key={k}
                      onClick={() => setDetail({metric:k,unit:t.unit})}
                    >
                      <span>{metrics[k]}</span>
                      <strong>
                        {t[k].toLocaleString("vi-VN")} {t.unit}
                      </strong>
                      <meter
                        aria-label={metrics[k]}
                        min={0}
                        max={Math.max(1, ...keys.map((m) => t[m]))}
                        value={t[k]}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
          <section className="panel">
            <div className="workspace-toolbar">
              <h2>{detail ? metrics[detail.metric]+" ("+detail.unit+")" : "Chi tiết theo lô"}</h2>
              {detail && (
                <button
                  className="button secondary"
                  onClick={() => setDetail(null)}
                >
                  Tất cả chỉ tiêu
                </button>
              )}
              <button
                className="button secondary"
                disabled={!data.rows.length||dirty}
                onClick={() =>
                  downloadCsv(
                    [
                      [
                        "Mã lô",
                        "Sản phẩm",
                        "Tổ chức",
                        "Đơn vị",
                        ...keys.map((k) => metrics[k]),
                      ],
                      ...data.rows.map((r) => [
                        r.lotCode,
                        r.product,
                        r.organization,
                        r.unit,
                        ...keys.map((k) => r[k]),
                      ]),
                    ],
                    "bao-cao.csv",
                  )
                }
              >
                Xuất CSV theo bộ lọc đã áp dụng
              </button>
            </div>
            <p>{rows.length} lô</p>{dirty&&<p role="status">Bộ lọc đã thay đổi. Nhấn Áp dụng bộ lọc để cập nhật số liệu và xuất CSV.</p>}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Lô</th>
                    <th>Sản phẩm</th>
                    <th>Tổ chức</th>
                    <th>Đơn vị</th>
                    {keys.map((k) => (
                      <th key={k}>{metrics[k]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.lotId}>
                      <td>
                        <Link href={"/lots/" + r.lotId}>{r.lotCode}</Link>
                      </td>
                      <td>{r.product}</td>
                      <td>{r.organization}</td>
                      <td>{r.unit}</td>
                      {keys.map((k) => (
                        <td key={k}>{r[k].toLocaleString("vi-VN")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && <p>Không có lô cho chỉ tiêu này.</p>}
          </section>
        </>
      )}
    </div>
  );
}
