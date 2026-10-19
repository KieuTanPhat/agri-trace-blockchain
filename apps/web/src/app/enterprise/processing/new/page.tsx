"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import type { Catalog } from "@/lib/workspace";
import { CommandState, LoadState, ManagePage, PageHeader, Section } from "@/components/manage";
import { lossReasonLabels, processTypeLabels, type Items, type RecordOf, type Row } from "@/lib/platform-admin";

type InputLine = { lotId: string; quantity: string };
type OutputLine = { productId: string; kind: string; quantity: string; unit: string; packaging: string; packageCount: string; expiryDate: string; lotName: string };
type LossLine = { reason: string; quantity: string; note: string };
const newOutput = (): OutputLine => ({ productId: "", kind: "PRODUCT", quantity: "", unit: "kg", packaging: "", packageCount: "", expiryDate: "", lotName: "" });
const sum = (xs: (string | number)[]) => xs.reduce<number>((a, x) => a + (Number(x) || 0), 0);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Draft a processing run. Totals must balance (inputs = products + by-products
 * + losses, in the base unit) before the API accepts it. */
export default function NewProcessingRunPage() {
  const router = useRouter();
  const materials = useWorkspaceData<Items>("/processing-runs/materials");
  const catalog = useWorkspaceData<Catalog>("/catalog");
  const conversions = useWorkspaceData<Items>("/processing-runs/unit-conversions");
  const command = useWorkspaceCommand();
  const [siteId, setSiteId] = useState("");
  const [processType, setProcessType] = useState("PRELIMINARY");
  const [recipe, setRecipe] = useState("");
  const [note, setNote] = useState("");
  const [inputs, setInputs] = useState<InputLine[]>([]);
  const [outputs, setOutputs] = useState<OutputLine[]>([newOutput()]);
  const [losses, setLosses] = useState<LossLine[]>([]);
  const available = (materials.data?.items ?? []).filter((m) => !m.blocked && (!siteId || m.siteId === siteId));
  const sites = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of materials.data?.items ?? []) map.set(String(m.siteId), String(m.siteName));
    return [...map];
  }, [materials.data]);
  const chosen = inputs.map((i) => available.find((m) => m.lotId === i.lotId)).filter(Boolean) as Row[];
  const chainId = chosen[0]?.chainId as string | undefined;
  const baseUnit = (chosen[0]?.unit as string | undefined) ?? "kg";
  const mixedChain = chosen.some((m) => m.chainId !== chainId);
  const mixedUnit = chosen.some((m) => m.unit !== baseUnit);
  const inputTotal = sum(inputs.map((i) => i.quantity));
  // Mirrors the API: base quantity = quantity in the base unit, otherwise
  // quantity × the product's declared factor. The server recomputes it.
  const factorOf = (o: OutputLine) =>
    same(o.unit, baseUnit)
      ? 1
      : Number(
          (conversions.data?.items ?? []).find(
            (c) => !c.revokedAt && c.productId === o.productId && same(String(c.unit), o.unit) && same(String(c.baseUnit), baseUnit),
          )?.factor ?? NaN,
        );
  const baseOf = (o: OutputLine) => Math.round((Number(o.quantity) || 0) * factorOf(o) * 1000) / 1000;
  const missingFactor = outputs.some((o) => o.productId && !same(o.unit, baseUnit) && Number.isNaN(factorOf(o)));
  const outputTotal = sum(outputs.map((o) => (Number.isNaN(factorOf(o)) ? 0 : baseOf(o))));
  const lossTotal = sum(losses.map((l) => l.quantity));
  const balanced = inputTotal > 0 && Math.abs(inputTotal - outputTotal - lossTotal) < 0.0005;
  const products = catalog.data?.products ?? [];

  async function submit() {
    if (!chainId) return;
    const result = await command.run<RecordOf<Row>>("/processing-runs", {
      chainId,
      siteId,
      processType,
      baseUnit,
      recipe: recipe || undefined,
      note: note || undefined,
      inputs,
      outputs: outputs.map((o) => ({
        productId: o.productId,
        kind: o.kind,
        quantity: o.quantity,
        unit: o.unit,
        packaging: o.packaging || undefined,
        packageCount: o.packageCount ? Number(o.packageCount) : undefined,
        expiryDate: o.expiryDate || undefined,
        lotName: o.lotName || undefined,
      })),
      losses: losses.map((l) => ({ reason: l.reason, quantity: l.quantity, note: l.note || undefined })),
    });
    if (result) router.push(`/enterprise/processing/${result.record.id}`);
  }

  return (
    <ManagePage form>
      <PageHeader back="/enterprise/processing" title="Lập lệnh chế biến" description="Chọn nguyên liệu cùng chuỗi, cùng đơn vị, khai báo thành phẩm và hao hụt. Lệnh nháp chưa trừ kho; chỉ khi hoàn tất mới trừ lượng và tạo lô." />
      <LoadState loading={materials.loading || catalog.loading} error={materials.error || catalog.error || conversions.error} />
      <CommandState command={command} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Section title="1. Cơ sở và quy trình">
          <div className="admin-inline-form">
            <label className="field">Cơ sở chế biến
              <select className="input" required value={siteId} onChange={(e) => { setSiteId(e.target.value); setInputs([]); }}>
                <option value="">Chọn cơ sở</option>
                {sites.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="field">Loại chế biến
              <select className="input" value={processType} onChange={(e) => setProcessType(e.target.value)}>
                {Object.entries(processTypeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field">Quy trình / công thức<input className="input" maxLength={500} value={recipe} onChange={(e) => setRecipe(e.target.value)} placeholder="Ví dụ: sấy 60°C trong 8 giờ" /></label>
            <label className="field">Ghi chú<input className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          </div>
        </Section>
        <Section title="2. Nguyên liệu đầu vào" help={`Đơn vị cơ sở: ${baseUnit}. Mọi lô đầu vào phải cùng chuỗi và cùng đơn vị.`}>
          {available.map((m) => {
            const line = inputs.find((i) => i.lotId === m.lotId);
            return (
              <div className="admin-inline-form" key={`${m.lotId}-${m.siteId}`}>
                <label className="reg-check">
                  <input
                    type="checkbox"
                    checked={!!line}
                    onChange={(e) => setInputs(e.target.checked ? [...inputs, { lotId: String(m.lotId), quantity: String(m.available) }] : inputs.filter((i) => i.lotId !== m.lotId))}
                  />
                  <span>{String(m.lotCode)} · {String(m.productName)} · còn {String(m.available)} {String(m.unit)} · {String(m.sourceOrganization)}</span>
                </label>
                {line && (
                  <label className="field">Lượng dùng
                    <input className="input" type="number" step="0.001" min="0.001" max={Number(m.available)} required value={line.quantity} onChange={(e) => setInputs(inputs.map((i) => (i.lotId === m.lotId ? { ...i, quantity: e.target.value } : i)))} />
                  </label>
                )}
              </div>
            );
          })}
          {!available.length && <p className="muted">Không có nguyên liệu khả dụng tại cơ sở đã chọn.</p>}
          {mixedChain && <p className="notice error">Các lô thuộc nhiều chuỗi khác nhau; tách thành nhiều lệnh.</p>}
          {mixedUnit && <p className="notice error">Các lô dùng đơn vị khác nhau; chọn lô cùng đơn vị.</p>}
        </Section>
        <Section title="3. Thành phẩm và phụ phẩm" help="Thành phẩm khác đơn vị cơ sở được quy đổi theo hệ số đã khai cho sản phẩm.">
          {outputs.map((o, index) => {
            const set = (patch: Partial<OutputLine>) => setOutputs(outputs.map((x, i) => (i === index ? { ...x, ...patch } : x)));
            return (
              <div className="admin-inline-form" key={index}>
                <label className="field">Sản phẩm
                  <select className="input" required value={o.productId} onChange={(e) => set({ productId: e.target.value })}>
                    <option value="">Chọn sản phẩm</option>
                    {products.filter((p) => p.status === "ACTIVE").map((p) => <option key={p.id} value={p.id}>{p.productName}</option>)}
                  </select>
                </label>
                <label className="field">Loại
                  <select className="input" value={o.kind} onChange={(e) => set({ kind: e.target.value })}>
                    <option value="PRODUCT">Thành phẩm</option>
                    <option value="BY_PRODUCT">Phụ phẩm</option>
                  </select>
                </label>
                <label className="field">Lượng<input className="input" type="number" step="0.001" min="0.001" required value={o.quantity} onChange={(e) => set({ quantity: e.target.value })} /></label>
                <label className="field">Đơn vị<input className="input" required maxLength={30} value={o.unit} onChange={(e) => set({ unit: e.target.value })} /></label>
                {!same(o.unit, baseUnit) && (
                  <p className={Number.isNaN(factorOf(o)) ? "notice error" : "muted"}>
                    {Number.isNaN(factorOf(o))
                      ? <>Chưa có hệ số quy đổi {o.unit} → {baseUnit} cho sản phẩm này. <Link href="/enterprise/processing/conversions">Khai hệ số</Link></>
                      : `Quy đổi: ${baseOf(o).toFixed(3)} ${baseUnit} (1 ${o.unit} = ${factorOf(o)} ${baseUnit})`}
                  </p>
                )}
                <label className="field">Quy cách<input className="input" maxLength={255} value={o.packaging} onChange={(e) => set({ packaging: e.target.value })} placeholder="Túi 500g" /></label>
                <label className="field">Số kiện<input className="input" type="number" min="1" value={o.packageCount} onChange={(e) => set({ packageCount: e.target.value })} /></label>
                <label className="field">Hạn sử dụng<input className="input" type="date" value={o.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} /></label>
                {outputs.length > 1 && <button type="button" className="button secondary small" onClick={() => setOutputs(outputs.filter((_, i) => i !== index))}>Bỏ</button>}
              </div>
            );
          })}
          <button type="button" className="button secondary" onClick={() => setOutputs([...outputs, newOutput()])}>Thêm thành phẩm/phụ phẩm</button>
        </Section>
        <Section title="4. Hao hụt">
          {losses.map((l, index) => {
            const set = (patch: Partial<LossLine>) => setLosses(losses.map((x, i) => (i === index ? { ...x, ...patch } : x)));
            return (
              <div className="admin-inline-form" key={index}>
                <label className="field">Lý do
                  <select className="input" value={l.reason} onChange={(e) => set({ reason: e.target.value })}>
                    {Object.entries(lossReasonLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="field">Lượng ({baseUnit})<input className="input" type="number" step="0.001" min="0.001" required value={l.quantity} onChange={(e) => set({ quantity: e.target.value })} /></label>
                <label className="field">Ghi chú<input className="input" maxLength={500} value={l.note} onChange={(e) => set({ note: e.target.value })} /></label>
                <button type="button" className="button secondary small" onClick={() => setLosses(losses.filter((_, i) => i !== index))}>Bỏ</button>
              </div>
            );
          })}
          <button type="button" className="button secondary" onClick={() => setLosses([...losses, { reason: "MOISTURE", quantity: "", note: "" }])}>Thêm hao hụt</button>
        </Section>
        <Section title="5. Cân bằng khối lượng">
          <p className={balanced ? "admin-check-ok" : "admin-check-alert"}>
            Đầu vào {inputTotal.toFixed(3)} {baseUnit} {balanced ? "=" : "≠"} thành phẩm {outputTotal.toFixed(3)} + hao hụt {lossTotal.toFixed(3)}
            {!balanced && ` (chênh ${(inputTotal - outputTotal - lossTotal).toFixed(3)})`}
          </p>
          <p className="muted">Nền tảng có thể cho phép sai lệch nhỏ theo cấu hình; nếu vượt mức, API sẽ từ chối.</p>
          <button className="button" disabled={command.pending || !inputs.length || !siteId || mixedChain || mixedUnit || missingFactor}>Lưu lệnh nháp</button>
        </Section>
      </form>
    </ManagePage>
  );
}
