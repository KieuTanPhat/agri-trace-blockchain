"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Search,
  Download,
  Leaf,
  Truck,
  Package,
  ChevronRight,
} from "lucide-react";
import type { LotTrace } from "@/lib/types";
import { StateBadge } from "./state-badge";
import { ResponsiveTable } from "./responsive-table";
import { labelForState } from "@/lib/display-labels";
import { formatTraceDate } from "@/lib/format-date";

export function LotTable({ lots }: { lots: LotTrace[] }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const [farm, setFarm] = useState("");
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const filtered = lots.filter(
    (lot) =>
      (!state || lot.currentState === state) &&
      (!farm || lot.farmOrg.organizationId === farm) &&
      `${lot.productName} ${lot.lotCode} ${lot.farmOrg.name}`
        .toLocaleLowerCase("vi")
        .includes(query.toLocaleLowerCase("vi")),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * perPage;
  const farms = [
    ...new Map(
      lots.map((lot) => [lot.farmOrg.organizationId, lot.farmOrg]),
    ).values(),
  ];
  const stats = [
    { label: "Tổng số lô", value: lots.length, icon: Leaf, state: "" },
    {
      label: "Đã đến điểm nhận",
      value: lots.filter((lot) => lot.currentState === "ARRIVED").length,
      icon: Package,
      state: "ARRIVED",
    },
    {
      label: "Đang vận chuyển",
      value: lots.filter((lot) => lot.currentState === "IN_TRANSPORT").length,
      icon: Truck,
      state: "IN_TRANSPORT",
    },
    {
      label: "Đã thu hoạch",
      value: lots.filter((lot) => lot.currentState === "HARVESTED").length,
      icon: Leaf,
      state: "HARVESTED",
    },
  ];
  function exportCsv() {
    const cell = (value: string) =>
      `"${value.replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
    const rows = [
      ["Nông sản", "Mã lô", "Trang trại", "Trạng thái"],
      ...filtered.map((lot) => [
        lot.productName,
        lot.lotCode,
        lot.farmOrg.name,
        labelForState(lot.currentState),
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "agritrace-lo-nong-san.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <section className="lot-stats" aria-label="Thống kê lô">
        {stats.map(({ icon: Icon, ...stat }) => (
          <button
            className="stat-card"
            key={stat.label}
            onClick={() => {
              setState(stat.state);
              setPage(1);
            }}
            aria-pressed={state === stat.state}
          >
            <span className="stat-icon">
              <Icon size={22} />
            </span>
            <span className="stat-body">
              <strong className="stat-value">{stat.value}</strong>
              <span className="stat-label">{stat.label}</span>
            </span>
          </button>
        ))}
      </section>
      <section className="panel lot-table-panel">
        <div className="table-toolbar">
          <label className="table-search">
            <Search size={20} />
            <input
              placeholder="Tên nông sản, mã lô, trang trại..."
              aria-label="Tìm lô"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            className="select"
            aria-label="Lọc trạng thái"
            value={state}
            onChange={(event) => {
              setState(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tất cả trạng thái</option>
            {[...new Set(lots.map((lot) => lot.currentState))].map((value) => (
              <option key={value} value={value}>
                {labelForState(value)}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Lọc trang trại"
            value={farm}
            onChange={(event) => {
              setFarm(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tất cả trang trại</option>
            {farms.map((item) => (
              <option key={item.organizationId} value={item.organizationId}>
                {item.name}
              </option>
            ))}
          </select>
          <button className="button secondary" onClick={exportCsv}>
            <Download size={18} />
            Xuất CSV
          </button>
        </div>
        <ResponsiveTable
          caption="Danh sách lô nông sản"
          rows={filtered.slice(start, start + perPage)}
          rowKey={(lot) => lot.lotId}
          columns={[
            {
              key: "product",
              label: "Nông sản",
              render: (lot) => (
                <Link className="product-link" href={`/lots/${lot.lotId}`}>
                  <span className="product-mark">
                    <Leaf size={20} />
                  </span>
                  {lot.productName}
                </Link>
              ),
            },
            { key: "code", label: "Mã lô", render: (lot) => lot.lotCode },
            {
              key: "farm",
              label: "Nông trại",
              render: (lot) => lot.farmOrg.name,
            },
            {
              key: "updated",
              label: "Cập nhật gần nhất",
              render: (lot) => {
                const latest = [...lot.timeline].sort((a, b) =>
                  b.eventTime.localeCompare(a.eventTime),
                )[0];
                return latest
                  ? formatTraceDate(latest.eventTime)
                  : "Chưa ghi nhận";
              },
            },
            {
              key: "state",
              label: "Trạng thái",
              render: (lot) => <StateBadge state={lot.currentState} />,
            },
            {
              key: "detail",
              label: "Chi tiết",
              render: (lot) => (
                <Link
                  className="button secondary small"
                  href={`/lots/${lot.lotId}`}
                  aria-label={`Xem lô ${lot.lotCode}`}
                >
                  Xem lô <ChevronRight size={16} />
                </Link>
              ),
            },
          ]}
        />
        {!filtered.length && (
          <p className="table-empty">Không có lô phù hợp với bộ lọc.</p>
        )}
        <div className="table-footer">
          <span role="status">
            Hiển thị {filtered.length ? start + 1 : 0} –{" "}
            {Math.min(start + perPage, filtered.length)} của {filtered.length}{" "}
            lô
          </span>
          <div className="pagination">
            <button
              className="icon-button pagination-btn"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
              aria-label="Trang trước"
            >
              &lt;
            </button>
            <span
              className="pagination-current"
              aria-label={`Trang ${currentPage} trên ${totalPages}`}
            >
              {currentPage}/{totalPages}
            </span>
            <button
              className="icon-button pagination-btn"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
              aria-label="Trang sau"
            >
              &gt;
            </button>
            <select
              className="select pagination-select"
              aria-label="Số lô mỗi trang"
              value={perPage}
              onChange={(event) => {
                setPerPage(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value={10}>10 / trang</option>
              <option value={25}>25 / trang</option>
              <option value={50}>50 / trang</option>
            </select>
          </div>
        </div>
      </section>
    </>
  );
}
