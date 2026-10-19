"use client";
import { useState, type FormEvent } from "react";
import { useWorkspaceData, useWorkspaceCommand, textValue, type Row, type Overview, type Items, type EnterpriseSite, type EnterpriseMember } from "@/lib/workspace";
import { CommandState, DataTable, LoadState, PageHeader, StatusBadge } from "@/components/manage";
import { EvidencePanel } from "@/components/workspace/evidence-panel";

type Tab = "stock" | "allocate" | "transfers" | "quarantine";
const transferStatus: Record<string, string> = { PENDING: "Chờ chuyển", IN_TRANSIT: "Đang chuyển", RECEIVED: "Đã nhận", DISCREPANCY: "Chênh lệch", CANCELLED: "Đã hủy" };
const transferTone: Record<string, string> = { PENDING: "PENDING_REVIEW", IN_TRANSIT: "CHECKING", RECEIVED: "APPROVED", DISCREPANCY: "FAILED", CANCELLED: "INACTIVE" };
const causes: Record<string, string> = { SUSPECTED_DAMAGE: "Nghi ngờ hư hỏng", QUALITY_FAILED: "Chất lượng không đạt", AWAITING_INSPECTION: "Chờ kiểm định", OTHER: "Khác" };
const caseStatus: Record<string, string> = { ACTIVE: "Đang cách ly", RELEASED: "Đã giải tỏa", DISPOSED: "Đã xử lý" };
const caseTone: Record<string, string> = { ACTIVE: "PENDING_REVIEW", RELEASED: "APPROVED", DISPOSED: "INACTIVE" };
const decimal = "[0-9]+(\\.[0-9]{1,3})?";

function lotState(lot: Row) {
  const notices = (lot.notices as Row[] | undefined) ?? [];
  if (notices.some((n) => n.kind === "RECALL") || lot.state === "RECALLED") return "Đang thu hồi";
  if (lot.expiryDate && String(lot.expiryDate).slice(0, 10) < new Date().toISOString().slice(0, 10)) return "Hết hạn";
  return lot.blocked ? "Khác" : "Bình thường";
}

/** Site stock, allocation of unassigned quantity, internal transfer slips and quarantine slips (aaa.txt 1.1–1.3). */
export default function InventoryPage() {
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const stock = useWorkspaceData<{ lots: Row[] }>("/distribution/reports");
  const sites = useWorkspaceData<Items<EnterpriseSite>>("/enterprise-workspace/sites");
  const permissions = overview.data?.permissions ?? [];
  const canMove = permissions.includes("inventory.manage");
  const canQuarantine = permissions.includes("quarantine.manage");
  const canAdjust = permissions.includes("quantity.adjust");
  const transfers = useWorkspaceData<Items<Row>>(canMove ? "/distribution/site-transfers" : null);
  const cases = useWorkspaceData<Items<Row>>(canQuarantine ? "/distribution/quarantine-cases" : null);
  const members = useWorkspaceData<Items<EnterpriseMember>>(canMove ? "/enterprise-workspace/members" : null);
  const cmd = useWorkspaceCommand();
  const [tab, setTab] = useState<Tab>("stock");
  const [lotId, setLotId] = useState("");
  const [done, setDone] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const lots = stock.data?.lots ?? [];
  const lot = lots.find((l) => l.lotId === lotId);
  const activeSites = (sites.data?.items ?? []).filter((s) => s.status === "ACTIVE");
  const siteName = (id: unknown) => activeSites.find((s) => s.id === id)?.name ?? textValue(id);
  const reload = () => { stock.reload(); transfers.reload(); cases.reload(); };

  async function send(path: string, payload: Record<string, unknown>, message: string) {
    setDone("");
    if (await cmd.run(path, payload)) { setDone(message); setOpen(null); reload(); return true; }
    return false;
  }
  const fields = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    for (const k of Object.keys(form)) if (form[k] === "") delete form[k];
    return form;
  };

  const lotSelect = (
    <label>Lô nông sản<select className="input" name="lotId" value={lotId} onChange={(e) => { setLotId(e.target.value); setDone(""); }} required>
      <option value="">Chọn lô</option>
      {lots.map((l) => <option key={String(l.lotId)} value={String(l.lotId)}>{textValue(l.lotCode)} · {textValue(l.productName)} · giữ {textValue(l.held)} {textValue(l.unit)}</option>)}
    </select></label>
  );
  const siteOptions = (filter?: (s: Row) => boolean) =>
    ((lot?.siteHoldings as Row[] | undefined) ?? []).filter(filter ?? (() => true)).map((s) => <option key={String(s.siteId)} value={String(s.siteId)}>{textValue(s.siteName)} · khả dụng {textValue(s.available)}</option>);

  const stockRows = lots.flatMap((l) => ((l.siteHoldings as Row[] | undefined) ?? []).map((s) => ({ l, s })));
  const tabs: [Tab, string, boolean][] = [["stock", "Tồn theo cơ sở", true], ["allocate", "Phân bổ", canMove], ["transfers", "Chuyển kho", canMove], ["quarantine", "Cách ly", canQuarantine]];

  return (
    <div className="manage-console">
      <PageHeader title="Tồn kho và cách ly theo cơ sở" description="Phân bổ và chuyển nội bộ giữ nguyên tổng lượng của lô. Hàng đang chuyển chỉ vào kho nhận theo lượng được xác nhận; cách ly cục bộ tách biệt với thu hồi toàn nguồn." back="/enterprise/reports" backLabel="Báo cáo & đối soát" />
      <LoadState {...stock} />
      <LoadState {...sites} />
      <div className="manage-filter-tabs" role="group" aria-label="Chức năng tồn kho">
        {tabs.filter(([, , allowed]) => allowed).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={tab === value} onClick={() => { setTab(value); setDone(""); }}>{label}</button>
        ))}
      </div>
      {done && <p className="notice" role="status">{done}</p>}
      <CommandState command={cmd} />

      {tab === "stock" && (
        <section className="panel">
          <h2>Tồn kho theo cơ sở</h2>
          <DataTable label="Tồn kho theo cơ sở" rows={stock.data ? stockRows : null} rowKey={({ l, s }) => `${l.lotId}-${s.siteId}`}
            empty={{ title: "Chưa có tồn tại cơ sở", description: "Phân bổ lượng của lô vào cơ sở để theo dõi tồn kho." }}
            columns={[
              { header: "Mã lô", cell: ({ l }) => <><strong>{textValue(l.lotCode)}</strong><small>{textValue(l.productName)}</small></> },
              { header: "Cơ sở lưu giữ", cell: ({ s }) => textValue(s.siteName) },
              { header: "Tổng đang giữ", cell: ({ l, s }) => `${textValue(s.quantity)} ${textValue(l.unit)}` },
              { header: "Giữ chỗ để giao", cell: ({ s }) => textValue(s.reserved) },
              { header: "Đang cách ly", cell: ({ s }) => textValue(s.quarantined) },
              { header: "Khả dụng", cell: ({ s }) => <strong>{textValue(s.available)}</strong> },
              { header: "Trạng thái lô", cell: ({ l }) => lotState(l) },
            ]} />
          {lots.some((l) => Number(l.unallocated) > 0 || Number(l.internalInTransit) > 0) && (
            <ul className="manage-description">
              {lots.filter((l) => Number(l.unallocated) > 0 || Number(l.internalInTransit) > 0).map((l) => (
                <li key={String(l.lotId)}>{textValue(l.lotCode)}: chưa phân bổ {textValue(l.unallocated)}, đang chuyển nội bộ {textValue(l.internalInTransit)} {textValue(l.unit)}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "allocate" && (
        <form className="panel workspace-form" onSubmit={async (e) => { const f = fields(e); await send("/distribution/allocations", { ...f, unit: lot?.unit, version: lot?.version }, "Đã phân bổ vào cơ sở."); }}>
          <h2>Phân bổ lượng chưa gắn cơ sở</h2>
          <p className="manage-description">Không cần xác nhận giao nhận vật lý. Chuyển hàng thực tế giữa hai kho dùng thẻ “Chuyển kho”.</p>
          <fieldset disabled={cmd.pending || cmd.frozen} className="enterprise-fields">
            {lotSelect}
            <p>Chưa phân bổ: <strong>{textValue(lot?.unallocated)} {textValue(lot?.unit)}</strong></p>
            <label>Cơ sở nhận<select className="input" name="siteId" required><option value="">Chọn cơ sở</option>{activeSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Khối lượng ({textValue(lot?.unit)})<input className="input" name="quantity" required inputMode="decimal" pattern={decimal} /></label>
            <label>Lý do<textarea className="input" name="reason" required minLength={10} maxLength={1000} /></label>
          </fieldset>
          <button className="button" disabled={cmd.pending}>{cmd.frozen ? "Thử lại yêu cầu cũ" : "Phân bổ"}</button>
        </form>
      )}

      {tab === "transfers" && (
        <>
          <form className="panel workspace-form" onSubmit={async (e) => { const f = fields(e); await send("/distribution/site-transfers", { ...f, unit: lot?.unit, version: lot?.version, dispatch: f.dispatch === "on" }, "Đã lập phiếu chuyển kho."); }}>
            <h2>Lập phiếu chuyển hàng giữa các cơ sở</h2>
            <fieldset disabled={cmd.pending || cmd.frozen} className="enterprise-fields">
              {lotSelect}
              <label>Cơ sở xuất hàng<select className="input" name="fromSiteId" required><option value="">Chọn cơ sở</option>{siteOptions((s) => Number(s.available) > 0)}</select></label>
              <label>Cơ sở nhận hàng<select className="input" name="toSiteId" required><option value="">Chọn cơ sở</option>{activeSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label>Khối lượng chuyển ({textValue(lot?.unit)})<input className="input" name="quantity" required inputMode="decimal" pattern={decimal} /></label>
              <label>Người nhận hàng (không bắt buộc)<select className="input" name="receiverUserId"><option value="">Chưa chỉ định</option>{(members.data?.items ?? []).filter((m) => m.accountStatus === "ACTIVE").map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}</select></label>
              <label>Lý do chuyển hàng<textarea className="input" name="reason" required minLength={10} maxLength={1000} /></label>
              <label>Ghi chú khác<textarea className="input" name="note" maxLength={1000} /></label>
              <label className="checkbox"><input type="checkbox" name="dispatch" /> Xuất hàng ngay sau khi lập phiếu</label>
            </fieldset>
            <button className="button" disabled={cmd.pending}>{cmd.frozen ? "Thử lại yêu cầu cũ" : "Lập phiếu"}</button>
          </form>
          <section className="panel">
            <h2>Phiếu chuyển kho</h2>
            <LoadState {...transfers} />
            <DataTable label="Phiếu chuyển kho" rows={transfers.data?.items} rowKey={(r) => String(r.id)}
              empty={{ title: "Chưa có phiếu chuyển", description: "Phiếu chuyển kho nội bộ xuất hiện tại đây." }}
              columns={[
                { header: "Mã phiếu", cell: (r) => <><strong>{textValue(r.code)}</strong><small>{textValue(r.lotCode)} · {textValue(r.productName)}</small></> },
                { header: "Từ → đến", cell: (r) => `${textValue(r.fromSiteName)} → ${textValue(r.toSiteName)}` },
                { header: "Khối lượng", cell: (r) => <>{textValue(r.quantity)} {textValue(r.unit)}{r.receivedQuantity != null && <small>thực nhận {textValue(r.receivedQuantity)}{Number(r.shortfall) > 0 ? ` · thiếu ${textValue(r.shortfall)}` : ""}</small>}</> },
                { header: "Trạng thái", cell: (r) => <StatusBadge value={transferTone[String(r.status)] ?? String(r.status)} label={transferStatus[String(r.status)] ?? String(r.status)} /> },
                { header: "Người lập", cell: (r) => <>{textValue(r.createdByName)}<small>{new Date(String(r.createdAt)).toLocaleString("vi-VN")}</small></> },
                { header: <span className="sr-only">Thao tác</span>, cell: (r) => <button type="button" className="button secondary" onClick={() => setOpen(open === r.id ? null : String(r.id))}>{open === r.id ? "Đóng" : "Chi tiết"}</button> },
              ]} />
            {(transfers.data?.items ?? []).filter((r) => r.id === open).map((r) => (
              <div key={String(r.id)} className="panel">
                <h3>{textValue(r.code)} · {transferStatus[String(r.status)]}</h3>
                <p>Lý do: {textValue(r.reason)}{r.note ? ` · Ghi chú: ${textValue(r.note)}` : ""}{r.receiverName ? ` · Người nhận: ${textValue(r.receiverName)}` : ""}</p>
                {r.status === "PENDING" && (
                  <div className="manage-header-actions">
                    <button className="button" type="button" disabled={cmd.pending} onClick={() => send(`/distribution/site-transfers/${r.id}/dispatch`, { version: r.version }, "Đã xuất hàng; lượng chuyển sang trạng thái đang chuyển.")}>Xuất hàng</button>
                    <button className="button secondary" type="button" disabled={cmd.pending} onClick={() => send(`/distribution/site-transfers/${r.id}/cancel`, { version: r.version }, "Đã hủy phiếu.")}>Hủy phiếu</button>
                  </div>
                )}
                {r.status === "IN_TRANSIT" && (
                  <form className="workspace-form" onSubmit={async (e) => { const f = fields(e); await send(`/distribution/site-transfers/${r.id}/receive`, { ...f, version: r.version }, "Đã xác nhận nhận hàng."); }}>
                    <label>Khối lượng thực nhận tại {siteName(r.toSiteId)} ({textValue(r.unit)})<input className="input" name="receivedQuantity" required inputMode="decimal" pattern={decimal} defaultValue={String(r.quantity)} /></label>
                    <label>Ghi chú nhận hàng<textarea className="input" name="note" maxLength={1000} /></label>
                    <button className="button" disabled={cmd.pending}>Xác nhận nhận hàng</button>
                  </form>
                )}
                {r.status === "DISCREPANCY" && (
                  <form className="workspace-form" onSubmit={async (e) => { const f = fields(e); await send(`/distribution/site-transfers/${r.id}/resolve`, { ...f, version: r.version }, "Đã xử lý chênh lệch."); }}>
                    <p>Còn {textValue(r.shortfall)} {textValue(r.unit)} chờ đối soát; không tự coi là đã mất.</p>
                    <label>Phương án<select className="input" name="resolution" required><option value="RETURNED">Hàng còn ở cơ sở xuất — trả lại tồn</option>{canAdjust && <option value="WRITTEN_OFF">Xác nhận hao hụt</option>}</select></label>
                    <label>Nội dung đối soát<textarea className="input" name="note" required minLength={10} maxLength={1000} /></label>
                    <button className="button" disabled={cmd.pending}>Ghi nhận xử lý</button>
                  </form>
                )}
                {r.resolution != null && <p>Đã xử lý: {r.resolution === "RETURNED" ? "trả lại cơ sở xuất" : "ghi hao hụt"} · {textValue(r.resolutionNote)}</p>}
                <EvidencePanel entityType="SITE_TRANSFER" entityId={String(r.id)} />
              </div>
            ))}
          </section>
        </>
      )}

      {tab === "quarantine" && (
        <>
          <form className="panel workspace-form" onSubmit={async (e) => { const f = fields(e); await send("/distribution/quarantine", { ...f, action: "HOLD", unit: lot?.unit, version: lot?.version }, "Đã lập phiếu cách ly."); }}>
            <h2>Lập phiếu cách ly</h2>
            <fieldset disabled={cmd.pending || cmd.frozen} className="enterprise-fields">
              {lotSelect}
              <label>Cơ sở đang giữ<select className="input" name="siteId" required><option value="">Chọn cơ sở</option>{siteOptions((s) => Number(s.available) > 0)}</select></label>
              <label>Khối lượng cách ly ({textValue(lot?.unit)})<input className="input" name="quantity" required inputMode="decimal" pattern={decimal} /></label>
              <label>Nguyên nhân<select className="input" name="cause" required>{Object.entries(causes).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label>Mô tả lý do<textarea className="input" name="reason" required minLength={10} maxLength={1000} /></label>
              <label>Ghi chú khác<textarea className="input" name="note" maxLength={1000} /></label>
            </fieldset>
            <button className="button" disabled={cmd.pending}>{cmd.frozen ? "Thử lại yêu cầu cũ" : "Đưa vào cách ly"}</button>
          </form>
          <section className="panel">
            <h2>Phiếu cách ly</h2>
            <LoadState {...cases} />
            <DataTable label="Phiếu cách ly" rows={cases.data?.items} rowKey={(r) => String(r.id)}
              empty={{ title: "Chưa có phiếu cách ly", description: "Phiếu cách ly tại cơ sở xuất hiện tại đây." }}
              columns={[
                { header: "Mã phiếu", cell: (r) => <><strong>{textValue(r.code)}</strong><small>{textValue(r.lotCode)} · {textValue(r.siteName)}</small></> },
                { header: "Nguyên nhân", cell: (r) => <>{causes[String(r.cause)] ?? textValue(r.cause)}<small>{textValue(r.reason)}</small></> },
                { header: "Khối lượng", cell: (r) => <>{textValue(r.quantity)} {textValue(r.unit)}<small>còn {textValue(r.openQuantity)} · giải tỏa {textValue(r.releasedQuantity)} · xử lý {textValue(r.disposedQuantity)}</small></> },
                { header: "Trạng thái", cell: (r) => <StatusBadge value={caseTone[String(r.status)] ?? String(r.status)} label={caseStatus[String(r.status)] ?? String(r.status)} /> },
                { header: "Người thực hiện", cell: (r) => <>{textValue(r.createdByName)}<small>{new Date(String(r.createdAt)).toLocaleString("vi-VN")}</small></> },
                { header: <span className="sr-only">Thao tác</span>, cell: (r) => <button type="button" className="button secondary" onClick={() => setOpen(open === r.id ? null : String(r.id))}>{open === r.id ? "Đóng" : "Chi tiết"}</button> },
              ]} />
            {(cases.data?.items ?? []).filter((r) => r.id === open).map((r) => {
              const caseLot = lots.find((l) => l.lotId === r.lotId);
              return (
                <div key={String(r.id)} className="panel">
                  <h3>{textValue(r.code)} · {caseStatus[String(r.status)]}</h3>
                  {r.status === "ACTIVE" && caseLot && (
                    <form className="workspace-form" onSubmit={async (e) => {
                      const f = fields(e);
                      const common = { lotId: r.lotId, siteId: r.siteId, quantity: f.quantity, unit: caseLot.unit, version: caseLot.version, quarantineCaseId: r.id, reason: f.reason };
                      if (f.mode === "DAMAGE") await send("/distribution/quantities", { ...common, kind: "DAMAGE", fromQuarantine: true }, "Đã ghi hư hỏng phần cách ly.");
                      else await send("/distribution/quarantine", { ...common, action: "RELEASE" }, "Đã giải tỏa cách ly.");
                    }}>
                      <label>Xử lý<select className="input" name="mode"><option value="RELEASE">Giải tỏa khi đủ điều kiện</option>{canAdjust && <option value="DAMAGE">Ghi hao hụt / hư hỏng</option>}</select></label>
                      <label>Khối lượng ({textValue(r.unit)}, còn {textValue(r.openQuantity)})<input className="input" name="quantity" required inputMode="decimal" pattern={decimal} defaultValue={String(r.openQuantity)} /></label>
                      <label>Lý do<textarea className="input" name="reason" required minLength={10} maxLength={500} /></label>
                      <button className="button" disabled={cmd.pending}>Ghi nhận</button>
                    </form>
                  )}
                  <EvidencePanel entityType="QUARANTINE" entityId={String(r.id)} siteId={String(r.siteId)} />
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
