"use client";

import Link from "next/link";
import { useState } from "react";
import { request } from "@/lib/api-client";
import { errorMessage, useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { labelForState } from "@/lib/display-labels";
import { CommandState, DataTable, LoadState, ManagePage, PageHeader, ReasonAction, Section, StatusBadge } from "@/components/manage";
import { shortDate, type Items, type RecordOf, type Row } from "@/lib/platform-admin";

type Lineage = { lotId: string; upstream: Row[]; downstream: Row[] };

function LineageTable({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <Section title={title}>
      <DataTable
        label={title}
        rows={rows}
        rowKey={(r) => String(r.lotId)}
        empty={{ title: "Không có", description: "Không có lô liên quan qua chế biến." }}
        columns={[
          { header: "Cấp", cell: (r) => String(r.level) },
          { header: "Lô", cell: (r) => <><strong>{String(r.lotCode)}</strong><br /><small>{String(r.productName)}</small></> },
          { header: "Tổ chức", cell: (r) => String(r.organizationName) },
          { header: "Lệnh chế biến", cell: (r) => String(r.runCode ?? "—") },
          { header: "Lượng dùng/còn", cell: (r) => (r.usedQuantity ? `${r.usedQuantity} ${r.usedUnit}` : `${r.availableQuantity} ${r.unit}`) },
          { header: "Trạng thái", cell: (r) => labelForState(String(r.currentState), String(r.originType)) },
        ]}
      />
    </Section>
  );
}

/** Search lots by code, QR token or product; follow lineage through processing
 * both ways and block a counterfeit QR. */
export default function AdminLotsPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const state = useWorkspaceData<Items>(query ? `/platform-admin/lots?q=${encodeURIComponent(query)}` : null);
  const command = useWorkspaceCommand();
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [lineageError, setLineageError] = useState("");
  const [message, setMessage] = useState("");
  async function openLineage(lotId: string) {
    setLineageError("");
    try {
      setLineage((await request<RecordOf<Lineage>>(`/platform-admin/lots/${lotId}/lineage`)).record);
    } catch (e) {
      setLineageError(errorMessage(e));
    }
  }
  return (
    <ManagePage>
      <PageHeader
        title="Tra cứu lô & sản phẩm"
        description="Tìm theo mã lô, mã truy xuất QR hoặc tên sản phẩm. Xem tổ chức đang giữ hàng, nguồn nguyên liệu và lô thành phẩm sinh ra qua chế biến."
      />
      <form
        className="manage-section admin-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
          setLineage(null);
        }}
      >
        <label className="field">
          Từ khóa
          <input className="input" value={q} minLength={2} required onChange={(e) => setQ(e.target.value)} placeholder="LOT-..., mã QR hoặc tên sản phẩm" />
        </label>
        <button className="button">Tìm</button>
      </form>
      <LoadState loading={!!query && state.loading} error={state.error} />
      <CommandState command={command} />
      {message && <p className="notice">{message}</p>}
      {state.data && (
        <Section title={`Kết quả (${state.data.items.length})`}>
          <DataTable<Row>
            label="Kết quả tra cứu lô"
            rows={state.data.items}
            rowKey={(r) => String(r.lotId)}
            empty={{ title: "Không tìm thấy lô", description: "Kiểm tra lại mã lô hoặc mã QR." }}
            columns={[
              { header: "Lô", cell: (r) => <><strong>{String(r.lotCode)}</strong><br /><small>{String(r.productName)}</small></> },
              { header: "Nguồn gốc", cell: (r) => (r.originType === "TRANSFORMATION" ? `Chế biến (${r.runCode})` : "Thu hoạch") },
              { header: "Tổ chức tạo", cell: (r) => <Link href={`/admin/directory/${r.organizationId}`}>{String(r.organizationName)}</Link> },
              { header: "Đang giữ", cell: (r) => (r.holders as Row[]).map((h) => `${h.organizationName}: ${h.quantity}`).join("; ") || "—" },
              { header: "Còn lại", cell: (r) => `${r.availableQuantity}/${r.initialQuantity} ${r.unit}` },
              { header: "Hạn dùng", cell: (r) => shortDate(r.expiryDate) },
              { header: "Trạng thái", cell: (r) => labelForState(String(r.currentState), String(r.originType)) },
              { header: "Lượt quét", cell: (r) => String(r.scans) },
              {
                header: "Thao tác",
                cell: (r) => (
                  <div className="actions">
                    <button type="button" className="button secondary small" onClick={() => void openLineage(String(r.lotId))}>
                      Cây nguồn gốc
                    </button>
                    {r.traceToken ? <Link className="button secondary small" href={`/trace/${r.traceToken}`}>Trang QR</Link> : null}
                    {r.qrBlock ? (
                      <StatusBadge value="LOCKED" label="QR đang khóa" />
                    ) : r.traceToken ? (
                      <ReasonAction
                        label="Khóa QR"
                        danger
                        disabled={command.pending}
                        extra={
                          <input
                            className="input"
                            id={`public-${r.lotId}`}
                            aria-label="Cảnh báo hiển thị cho người quét"
                            placeholder="Cảnh báo hiển thị cho người quét (tối thiểu 10 ký tự)"
                            minLength={10}
                            required
                          />
                        }
                        onSubmit={async (reason) => {
                          const input = document.getElementById(`public-${r.lotId}`) as HTMLInputElement | null;
                          const done = await command.run("/platform-admin/qr-blocks", { lotId: r.lotId, reason, publicMessage: input?.value.trim() ?? "" });
                          if (done !== false) {
                            setMessage("Đã khóa mã QR; trang truy xuất hiển thị cảnh báo.");
                            state.reload();
                          }
                          return done;
                        }}
                      />
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        </Section>
      )}
      {lineageError && <p className="notice error">{lineageError}</p>}
      {lineage && (
        <>
          <LineageTable title="Truy ngược: lô nguyên liệu" rows={lineage.upstream} />
          <LineageTable title="Truy xuôi: lô thành phẩm (phạm vi thu hồi)" rows={lineage.downstream} />
          <p className="muted">
            Muốn xem lượng phân bổ và các chặng giao nhận, mở <Link href="/admin/recall">Diễn tập thu hồi</Link> với lô {lineage.lotId}.
          </p>
        </>
      )}
    </ManagePage>
  );
}
