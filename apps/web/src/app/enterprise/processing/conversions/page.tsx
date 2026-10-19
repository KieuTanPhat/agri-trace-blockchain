"use client";

import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import type { Catalog } from "@/lib/workspace";
import { CommandState, DataTable, LoadState, ManagePage, PageHeader, ReasonAction, ReloadButton, Section, StatusBadge } from "@/components/manage";
import { dateTime, type Items, type Row } from "@/lib/platform-admin";

const emptyForm = { productId: "", unit: "", baseUnit: "kg", factor: "", note: "" };

/** Factors that turn a processed product's recorded unit into the run's base
 * unit. The mass balance uses them; a factor is revoked, never edited. */
export default function UnitConversionsPage() {
  const state = useWorkspaceData<Items>("/processing-runs/unit-conversions");
  const catalog = useWorkspaceData<Catalog>("/catalog");
  const command = useWorkspaceCommand();
  const [form, setForm] = useState(emptyForm);
  const products = (catalog.data?.products ?? []).filter((p) => p.status === "ACTIVE" && p.organizationId);
  return (
    <ManagePage>
      <PageHeader
        back="/enterprise/processing"
        title="Hệ số quy đổi đơn vị"
        description="Khai số đơn vị cơ sở (ví dụ kg) trong một đơn vị ghi nhận thành phẩm (ví dụ hộp). Lệnh chế biến dùng hệ số này để cân bằng khối lượng; không sửa được hệ số đã khai, chỉ thu hồi rồi khai hệ số mới."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <CommandState command={command} />
      <Section title="Khai hệ số mới">
        <form
          className="admin-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const done = await command.run("/processing-runs/unit-conversions", {
              productId: form.productId,
              unit: form.unit.trim(),
              baseUnit: form.baseUnit.trim(),
              factor: form.factor,
              note: form.note.trim() || undefined,
            });
            if (done !== false) {
              setForm(emptyForm);
              state.reload();
            }
          }}
        >
          <label className="field">Sản phẩm
            <select className="input" required value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
              <option value="">Chọn sản phẩm</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.productName}</option>)}
            </select>
          </label>
          <label className="field">Đơn vị ghi nhận<input className="input" required maxLength={30} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="hộp" /></label>
          <label className="field">Đơn vị cơ sở<input className="input" required maxLength={30} value={form.baseUnit} onChange={(e) => setForm({ ...form, baseUnit: e.target.value })} /></label>
          <label className="field">Hệ số (1 đơn vị ghi nhận = ? đơn vị cơ sở)
            <input className="input" required inputMode="decimal" pattern="^(?:0|[1-9]\d{0,7})(?:\.\d{1,6})?$" value={form.factor} onChange={(e) => setForm({ ...form, factor: e.target.value })} placeholder="0.5" />
          </label>
          <label className="field">Ghi chú<input className="input" maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Hộp 500 g tịnh" /></label>
          <button className="button" disabled={command.pending}>Khai hệ số</button>
        </form>
      </Section>
      <Section title="Hệ số đã khai">
        <LoadState loading={state.loading || catalog.loading} error={state.error || catalog.error} />
        <DataTable<Row>
          label="Hệ số quy đổi"
          rows={state.data?.items ?? []}
          rowKey={(r) => String(r.id)}
          empty={{ title: "Chưa có hệ số", description: "Thành phẩm cùng đơn vị cơ sở không cần hệ số." }}
          columns={[
            { header: "Sản phẩm", cell: (r) => String(r.productName) },
            { header: "Quy đổi", cell: (r) => `1 ${r.unit} = ${r.factor} ${r.baseUnit}` },
            { header: "Ghi chú", cell: (r) => String(r.note ?? "—") },
            { header: "Khai lúc", cell: (r) => dateTime(r.createdAt) },
            {
              header: "Trạng thái",
              cell: (r) =>
                r.revokedAt ? (
                  <><StatusBadge value="REVOKED" label="Đã thu hồi" /><br /><small>{String(r.revokeReason)}</small></>
                ) : (
                  <StatusBadge value="ACTIVE" label="Đang dùng" />
                ),
            },
            {
              header: "Thao tác",
              cell: (r) =>
                r.revokedAt ? null : (
                  <ReasonAction
                    label="Thu hồi"
                    danger
                    placeholder="Lý do thu hồi (tối thiểu 10 ký tự). Lệnh nháp dùng hệ số này sẽ không hoàn tất được."
                    disabled={command.pending}
                    onSubmit={async (reason) => {
                      const done = await command.run(`/processing-runs/unit-conversions/${r.id}/revoke`, { reason });
                      if (done !== false) state.reload();
                      return done;
                    }}
                  />
                ),
            },
          ]}
        />
      </Section>
    </ManagePage>
  );
}
