"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { CommandState, DataTable, LoadState, ManagePage, PageHeader, ReasonAction, ReloadButton, Section, StatusBadge } from "@/components/manage";
import { dateTime, money, resourceLabels, type Items, type Row } from "@/lib/platform-admin";

type Plan = Row & { code: string; name: string; audience: string; versions: (Row & { limits: Record<string, number> })[] };
const audienceLabels: Record<string, string> = { PRODUCER: "Nhà sản xuất/HTX", SUPPLY_CHAIN_ENTERPRISE: "Doanh nghiệp chuỗi cung ứng" };
const versionStatus: Record<string, string> = { DRAFT: "Nháp", PUBLISHED: "Đang bán", RETIRED: "Ngừng bán" };

function DraftForm({ plan, onDone }: { plan: Plan; onDone(): void }) {
  const current = plan.versions.find((v) => v.status === "PUBLISHED");
  const command = useWorkspaceCommand();
  const [form, setForm] = useState({
    setupFee: Number(current?.setupFee ?? 0),
    annualFee: Number(current?.annualFee ?? 0),
    termMonths: Number(current?.termMonths ?? 12),
    products: current?.limits.products ?? 5,
    chains: current?.limits.chains ?? 1,
    members: current?.limits.members ?? 10,
    qrLabels: current?.limits.qrLabels ?? 10000,
    note: "",
  });
  const num = (key: keyof typeof form, text: string) => (
    <label className="field">
      {text}
      <Input className="input" type="number" min={0} value={form[key] as number} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} />
    </label>
  );
  return (
    <form
      className="admin-inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const { note, products, chains, members, qrLabels, ...fees } = form;
        if ((await command.run(`/platform-billing/plans/${plan.code}/versions`, { ...fees, limits: { products, chains, members, qrLabels }, note })) !== false) onDone();
      }}
    >
      {num("setupFee", "Phí khởi tạo (₫)")}
      {num("annualFee", "Phí duy trì (₫)")}
      {num("termMonths", "Kỳ hạn (tháng)")}
      {num("products", "Sản phẩm")}
      {num("chains", "Chuỗi")}
      {num("members", "Thành viên")}
      {num("qrLabels", "Tem QR/kỳ")}
      <label className="field">
        Ghi chú thay đổi
        <Input className="input" required minLength={10} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </label>
      <Button className="button" disabled={command.pending}>Tạo phiên bản nháp</Button>
      <CommandState command={command} />
    </form>
  );
}

/** Versioned catalog: a draft becomes the selling price only when published;
 * published versions are immutable so quotations keep their snapshot. */
export default function BillingPlansPage() {
  const state = useWorkspaceData<Items<Plan>>("/platform-billing/plans");
  const command = useWorkspaceCommand();
  const [editing, setEditing] = useState("");
  return (
    <ManagePage>
      <PageHeader
        title="Gói dịch vụ & bảng giá"
        description="Nhà sản xuất/HTX và doanh nghiệp chuỗi mua gói; vận chuyển, chế biến, phân phối, bán lẻ tham gia miễn phí theo hạn mức nền tảng. Công bố bảng giá cần người thứ hai duyệt khi bật phê duyệt hai bước."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <LoadState loading={state.loading} error={state.error} />
      <CommandState command={command} />
      {state.data?.items.map((plan) => (
        <Section
          key={plan.code}
          title={`${plan.name} (${plan.code})`}
          help={`Đối tượng: ${audienceLabels[plan.audience] ?? plan.audience}`}
          actions={
            !plan.versions.some((v) => v.status === "DRAFT") && (
              <Button type="button" className="button secondary" onClick={() => setEditing(editing === plan.code ? "" : plan.code)}>
                {editing === plan.code ? "Đóng" : "Soạn bảng giá mới"}
              </Button>
            )
          }
        >
          {editing === plan.code && <DraftForm plan={plan} onDone={() => { setEditing(""); state.reload(); }} />}
          <DataTable
            label={`Phiên bản ${plan.code}`}
            rows={plan.versions}
            rowKey={(v) => String(v.id)}
            columns={[
              { header: "Phiên bản", cell: (v) => `v${v.version}` },
              { header: "Khởi tạo / duy trì", cell: (v) => `${money(v.setupFee)} / ${money(v.annualFee)}` },
              { header: "Kỳ hạn", cell: (v) => `${v.termMonths} tháng` },
              { header: "Hạn mức", cell: (v) => Object.entries(v.limits).map(([k, n]) => `${resourceLabels[k] ?? k}: ${n}`).join(" · ") },
              { header: "Đang dùng", cell: (v) => String(v.activeSubscriptions ?? 0) },
              { header: "Trạng thái", cell: (v) => <StatusBadge value={v.status === "PUBLISHED" ? "ACTIVE" : v.status === "DRAFT" ? "PENDING_REVIEW" : "INACTIVE"} label={versionStatus[String(v.status)]} /> },
              { header: "Công bố", cell: (v) => dateTime(v.publishedAt) },
              {
                header: "Thao tác",
                cell: (v) =>
                  v.status === "DRAFT" ? (
                    <ReasonAction
                      label="Công bố"
                      disabled={command.pending}
                      onSubmit={async (reason) => {
                        const done = await command.run(`/platform-billing/plan-versions/${v.id}/publish`, { reason });
                        if (done !== false) state.reload();
                        return done;
                      }}
                    />
                  ) : null,
              },
            ]}
          />
        </Section>
      ))}
    </ManagePage>
  );
}
