"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { CommandState, DataTable, LoadState, ManagePage, PageHeader, ReloadButton, Section, StatusBadge, Tabs } from "@/components/manage";
import { referenceCategoryLabels, type Items, type Row } from "@/lib/platform-admin";

type Item = Row & { id: string; category: string; code: string; label: string; status: string; sortOrder: number; version: number };
const empty = { code: "", label: "", description: "", status: "ACTIVE", sortOrder: 100 };

/** Shared lists (units, product groups, certificate types, loss reasons…).
 * Items are deactivated, never deleted, so old records keep their label. */
export default function ReferenceDataPage() {
  const [category, setCategory] = useState("UNIT");
  const state = useWorkspaceData<Items<Item>>(`/platform-admin/reference-items?category=${category}`);
  const command = useWorkspaceCommand();
  const [form, setForm] = useState<typeof empty & { version?: number }>(empty);
  async function save() {
    const done = await command.run("/platform-admin/reference-items", { ...form, category, code: form.code.trim().toUpperCase(), description: form.description || undefined });
    if (done !== false) {
      setForm(empty);
      state.reload();
    }
  }
  return (
    <ManagePage>
      <PageHeader title="Danh mục dùng chung" description="Danh mục dùng chung cho mọi doanh nghiệp. Ngừng dùng thay vì xóa để giữ nhãn trong dữ liệu cũ." actions={<ReloadButton onClick={state.reload} />} />
      <Tabs value={category} onChange={(v) => { setCategory(v); setForm(empty); }} tabs={Object.entries(referenceCategoryLabels).map(([value, text]) => ({ value, label: text }))} />
      <CommandState command={command} />
      <Section title={form.version === undefined ? "Thêm mục" : `Sửa mục ${form.code}`}>
        <form className="admin-inline-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="field">Mã<Input className="input" required pattern="[A-Za-z0-9_]{1,40}" disabled={form.version !== undefined} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label className="field">Tên hiển thị<Input className="input" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          <label className="field">Mô tả<Input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label className="field">Thứ tự<Input className="input" type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} /></label>
          <label className="field">Trạng thái
            <NativeSelect className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="ACTIVE">Đang dùng</option>
              <option value="INACTIVE">Ngừng dùng</option>
            </NativeSelect>
          </label>
          <Button className="button" disabled={command.pending}>Lưu</Button>
          {form.version !== undefined && <Button type="button" className="button secondary" onClick={() => setForm(empty)}>Hủy sửa</Button>}
        </form>
      </Section>
      <LoadState loading={state.loading} error={state.error} />
      <Section label="Danh mục">
        <DataTable<Item>
          label="Mục danh mục"
          rows={state.data?.items}
          rowKey={(r) => r.id}
          empty={{ title: "Chưa có mục", description: "Thêm mục đầu tiên cho danh mục này." }}
          columns={[
            { header: "Mã", cell: (r) => r.code },
            { header: "Tên", cell: (r) => r.label },
            { header: "Mô tả", cell: (r) => String(r.description ?? "—") },
            { header: "Thứ tự", cell: (r) => String(r.sortOrder) },
            { header: "Trạng thái", cell: (r) => <StatusBadge value={r.status} /> },
            { header: "", cell: (r) => <Button type="button" className="button secondary small" onClick={() => setForm({ code: r.code, label: r.label, description: String(r.description ?? ""), status: r.status, sortOrder: r.sortOrder, version: r.version })}>Sửa</Button> },
          ]}
        />
      </Section>
    </ManagePage>
  );
}
