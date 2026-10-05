"use client";
import { lotsStyles } from "@/styles";
import { withFeatureClasses } from "@/shared/utils/feature-classes";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Search,
  Download,
  Leaf,
  Sprout,
  Truck,
  Award,
  House,
  ChevronRight,
  MoreHorizontal,
  Clock,
  MapPin,
} from "lucide-react";
import type { LotTrace } from "@/shared/types/domain";
import { StateBadge } from "@/shared/ui/state-badge";
import { labelForState } from "@/shared/utils/display-labels";
import { formatTraceDate } from "@/shared/utils/format-date";

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
  const farms = [
    ...new Map(
      lots.map((lot) => [lot.farmOrg.organizationId, lot.farmOrg]),
    ).values(),
  ];
  const stats = [
    { label: "Tổng số lô nông sản", value: lots.length, icon: Leaf, state: "" },
    {
      label: "Đã đến điểm nhận",
      value: lots.filter((lot) => lot.currentState === "ARRIVED").length,
      icon: Sprout,
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
      icon: Award,
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
    const a = document.createElement("a");
    a.href = url;
    a.download = "agritrace-lo-nong-san.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <section className={withFeatureClasses("lot-stats", lotsStyles)}>
        {stats.map(({ icon: Icon, ...s }) => (
          <button
            className="stat-card"
            key={s.label}
            onClick={() => setState(s.state)}
            aria-pressed={state === s.state}
          >
            <span className="stat-icon">
              <Icon />
            </span>
            <span className="stat-body">
              <strong className="stat-value">{s.value}</strong>
              <span className="stat-label">{s.label}</span>
            </span>
            <ChevronRight size={18} />
          </button>
        ))}
      </section>
      <section className="panel lot-table-panel">
        <div className={withFeatureClasses("table-toolbar", lotsStyles)}>
          <label className={withFeatureClasses("table-search", lotsStyles)}>
            <Search size={20} />
            <input
              placeholder="Tìm theo tên nông sản, mã lô, trang trại..."
              aria-label="Tìm lô"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            className="select"
            aria-label="Lọc trạng thái"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            {[...new Set(lots.map((lot) => lot.currentState))].map((s) => (
              <option key={s} value={s}>
                {labelForState(s)}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Lọc trang trại"
            value={farm}
            onChange={(e) => setFarm(e.target.value)}
          >
            <option value="">Tất cả trang trại</option>
            {farms.map((f) => (
              <option key={f.organizationId} value={f.organizationId}>
                {f.name}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Thời gian" defaultValue="">
            <option value="">Mọi thời gian</option>
          </select>
          <button className="button secondary" onClick={exportCsv}>
            <Download size={18} />
            Xuất dữ liệu
          </button>
        </div>
        <div className="table-scroll">
          <table className={withFeatureClasses("lot-table", lotsStyles)}>
            <thead>
              <tr>
                <th>#</th>
                <th>Nông sản</th>
                <th>Mã lô</th>
                <th>Trang trại</th>
                <th>Cập nhật gần nhất</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered
                .slice((page - 1) * perPage, page * perPage)
                .map((b, i) => {
                  const latest = [...b.timeline].sort((a, c) =>
                    c.eventTime.localeCompare(a.eventTime),
                  )[0];
                  return (
                    <tr key={b.lotId}>
                      <td>{(page - 1) * perPage + i + 1}</td>
                      <td>
                        <Link
                          href={`/lots/${b.lotId}`}
                          className={withFeatureClasses(
                            "product-cell",
                            lotsStyles,
                          )}
                        >
                          <span
                            className={withFeatureClasses(
                              `product-thumb ${b.productName.toLowerCase().includes("xoài") ? "mango-thumb" : ""}`,
                              lotsStyles,
                            )}
                          >
                            {b.productName.toLowerCase().includes("xoài") ? (
                              "🥭"
                            ) : (
                              <Image
                                src="/assets/shared/farm-greens.png"
                                alt=""
                                width={104}
                                height={112}
                              />
                            )}
                          </span>
                          <strong>{b.productName}</strong>
                        </Link>
                      </td>
                      <td>{b.lotCode}</td>
                      <td>
                        <span
                          className={withFeatureClasses(
                            "farm-cell",
                            lotsStyles,
                          )}
                        >
                          <House size={20} />
                          <div>
                            <strong>{b.farmOrg.name}</strong>
                            <span
                              className={withFeatureClasses(
                                "farm-location",
                                lotsStyles,
                              )}
                            >
                              <MapPin size={12} />
                              {b.farmOrg.type === "FARM"
                                ? "Cù Chi, TP. Hồ Chí Minh"
                                : "Nhà Bè, TP. Hồ Chí Minh"}
                            </span>
                          </div>
                        </span>
                      </td>
                      <td>
                        <div
                          className={withFeatureClasses(
                            "update-cell",
                            lotsStyles,
                          )}
                        >
                          <span
                            className={withFeatureClasses(
                              "update-time",
                              lotsStyles,
                            )}
                          >
                            <Clock size={14} />
                            {latest
                              ? formatTraceDate(latest.eventTime)
                              : "Chưa ghi nhận"}
                          </span>
                          <span
                            className={withFeatureClasses(
                              "update-by",
                              lotsStyles,
                            )}
                          >
                            Bởi {b.farmOrg.name}
                          </span>
                        </div>
                      </td>
                      <td>
                        <StateBadge state={b.currentState} />
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Thao tác ${b.productName}`}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <p className={withFeatureClasses("table-empty", lotsStyles)}>
            Không có lô phù hợp với bộ lọc.
          </p>
        )}
        <div className={withFeatureClasses("table-footer", lotsStyles)}>
          <span>
            Hiển thị {Math.min((page - 1) * perPage + 1, filtered.length)} –{" "}
            {Math.min(page * perPage, filtered.length)} của {filtered.length} lô
            nông sản
          </span>
          <div className={withFeatureClasses("pagination", lotsStyles)}>
            <button
              className={withFeatureClasses(
                "icon-button pagination-btn",
                lotsStyles,
              )}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Trang trước"
            >
              &lt;
            </button>
            <span
              className={withFeatureClasses("pagination-current", lotsStyles)}
            >
              {page}
            </span>
            <button
              className={withFeatureClasses(
                "icon-button pagination-btn",
                lotsStyles,
              )}
              disabled={page * perPage >= filtered.length}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Trang sau"
            >
              &gt;
            </button>
            <select
              className={withFeatureClasses(
                "select pagination-select",
                lotsStyles,
              )}
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
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
