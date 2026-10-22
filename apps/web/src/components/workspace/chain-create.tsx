"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import {
  labels,
  useWorkspaceCommand,
  useWorkspaceData,
  type Catalog,
  type EnterprisePartner,
  type Items,
  type Overview,
} from "@/lib/workspace";
import { CommandState, InfoDialog, PageHeader } from "@/components/manage";

export const CHAIN_TYPES: [string, string][] = [
  ["CROP", "Nông sản trồng trọt"],
  ["LIVESTOCK", "Chăn nuôi"],
  ["AQUACULTURE", "Thủy sản"],
  ["PROCESSED_FOOD", "Thực phẩm chế biến"],
];
export const chainTypeLabel = (code: string) =>
  CHAIN_TYPES.find(([c]) => c === code)?.[1] ?? code;
export const STAGES: [string, string][] = [
  ["FARM", "Sản xuất"],
  ["PROCESSOR", "Chế biến"],
  ["TRANSPORTER", "Vận chuyển"],
  ["DISTRIBUTOR", "Phân phối"],
  ["RETAILER", "Bán lẻ"],
];
type Stage = { stage: string; organizationIds: string[] };

/** The supply model in stage order: who performs each step of the chain. */
export function SupplyModelView({
  stages,
  name,
}: {
  stages: Stage[];
  name: (id: string) => string;
}) {
  if (!stages.length)
    return <p className="muted">Chưa khai báo mô hình chuỗi cung ứng.</p>;
  return (
    <ol className="supply-model" aria-label="Mô hình chuỗi cung ứng">
      {STAGES.filter(([code]) => stages.some((s) => s.stage === code)).map(
        ([code, title]) => (
          <li key={code}>
            <strong>{title}</strong>
            <ul>
              {stages
                .find((s) => s.stage === code)!
                .organizationIds.map((id) => (
                  <li key={id}>{name(id)}</li>
                ))}
            </ul>
          </li>
        ),
      )}
    </ol>
  );
}

/** New chain with its required supply model. */
export function ChainCreate() {
  const router = useRouter();
  const command = useWorkspaceCommand();
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const partners = useWorkspaceData<Items<EnterprisePartner>>(
    "/enterprise-workspace/partners",
  );
  const catalog = useWorkspaceData<Catalog>("/catalog");
  const own = overview.data?.organization;
  const [form, setForm] = useState({
    name: "",
    chainType: "CROP",
    description: "",
    plannedStartDate: "",
    note: "",
  });
  const [productIds, setProductIds] = useState<string[]>([]);
  // organizationId -> stages it performs
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);

  const organizations = useMemo(() => {
    const rows: { id: string; name: string; kinds: string[]; own: boolean }[] = [];
    if (own) rows.push({ id: own.id, name: own.name, kinds: own.capabilities, own: true });
    for (const p of partners.data?.items ?? []) {
      if (p.status !== "ACTIVE") continue;
      const org = p.inviterId === own?.id ? p.invitee : p.inviter;
      if (org && !rows.some((r) => r.id === org.id))
        rows.push({ id: org.id, name: org.name, kinds: [org.type], own: false });
    }
    return rows;
  }, [own, partners.data]);
  const name = (id: string) => organizations.find((o) => o.id === id)?.name ?? id;
  const stages: Stage[] = STAGES.map(([stage]) => ({
    stage,
    organizationIds: Object.entries(picked)
      .filter(([, s]) => s.includes(stage))
      .map(([id]) => id),
  })).filter((s) => s.organizationIds.length);
  const participants = Object.entries(picked).flatMap(([organizationId, s]) =>
    s.map((stage) => ({ organizationId, stage })),
  );

  function toggle(id: string, stage: string, on: boolean) {
    setPicked((current) => {
      const next = on
        ? [...new Set([...(current[id] ?? []), stage])]
        : (current[id] ?? []).filter((s) => s !== stage);
      const copy = { ...current, [id]: next };
      if (!next.length) delete copy[id];
      return copy;
    });
    setErrors((e) => ({ ...e, model: "" }));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = "Nhập tên chuỗi từ 2 ký tự.";
    if (!own || !(picked[own.id] ?? []).length)
      next.model = "Chọn ít nhất một khâu do doanh nghiệp của bạn đảm nhận.";
    else if (!participants.length) next.model = "Chọn các tổ chức tham gia chuỗi.";
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setReview(true);
  }
  async function confirm() {
    const result = await command.run<{ id?: string }>(
      "/supply-chains",
      {
        name: form.name.trim(),
        chainType: form.chainType,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.plannedStartDate ? { plannedStartDate: form.plannedStartDate } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        ...(productIds.length ? { productIds } : {}),
        participants,
      },
      "POST",
      { confirmed: true },
    );
    setReview(false);
    if (result && result.id) router.push(`/supply-chains/${result.id}`);
  }
  const field = (key: keyof typeof form, label: string, type = "text", required = false) => (
    <label>
      {label} {required && <span aria-hidden="true">*</span>}
      {key === "description" || key === "note" ? (
        <Textarea
          className="input"
          rows={3}
          maxLength={2000}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      ) : (
        <Input
          className="input"
          type={type}
          maxLength={255}
          value={form[key]}
          aria-invalid={errors[key] ? true : undefined}
          onChange={(e) => {
            setForm({ ...form, [key]: e.target.value });
            setErrors({ ...errors, [key]: "" });
          }}
        />
      )}
      {errors[key] && (
        <span className="field-error" role="alert">
          {errors[key]}
        </span>
      )}
    </label>
  );
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        title="Thêm chuỗi truy xuất"
        description="Khai báo thông tin chuỗi và mô hình chuỗi cung ứng: chọn các tổ chức tham gia ở từng khâu. Tổ chức khác được mời vào chuỗi khi tạo."
        back="/supply-chains"
        backLabel="Quay lại danh sách"
      />
      <form className="panel workspace-form chain-create" onSubmit={submit} noValidate>
        <CommandState command={command} />
        <fieldset className="enterprise-fields chain-create-fields" disabled={command.pending}>
          {field("name", "Tên chuỗi", "text", true)}
          <label>
            Loại chuỗi <span aria-hidden="true">*</span>
            <NativeSelect
              className="input"
              value={form.chainType}
              onChange={(e) => setForm({ ...form, chainType: e.target.value })}
            >
              {CHAIN_TYPES.map(([code, title]) => (
                <option key={code} value={code}>
                  {title}
                </option>
              ))}
            </NativeSelect>
          </label>
          {field("plannedStartDate", "Ngày bắt đầu hoạt động", "date")}
          <label>
            Sản phẩm liên kết (không bắt buộc)
            <NativeSelect
              className="input"
              multiple
              value={productIds}
              onChange={(e) =>
                setProductIds([...e.target.selectedOptions].map((o) => o.value))
              }
            >
              {(catalog.data?.products ?? [])
                .filter((p) => p.status === "ACTIVE")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.productName}
                  </option>
                ))}
            </NativeSelect>
          </label>
          <div className="full-row">{field("description", "Mô tả chuỗi")}</div>
          <div className="full-row">{field("note", "Ghi chú khác")}</div>
        </fieldset>
        <fieldset className="chain-model-picker" disabled={command.pending}>
          <legend>
            Mô hình chuỗi cung ứng <span aria-hidden="true">*</span>
          </legend>
          <p className="muted">
            Tích khâu mà từng tổ chức đảm nhận. Danh sách gồm doanh nghiệp của bạn và các doanh nghiệp liên kết đang hoạt động.
          </p>
          <div className="manage-table-scroll">
            <Table className="manage-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Tổ chức</TableHead>
                  {STAGES.map(([code, title]) => (
                    <TableHead key={code}>{title}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell data-label="Tổ chức">
                      <strong>{o.name}</strong>
                      <small>
                        {o.own ? "Doanh nghiệp của bạn · " : ""}
                        {o.kinds.map((k) => labels[k] ?? k).join(", ")}
                      </small>
                    </TableCell>
                    {STAGES.map(([code, title]) => (
                      <TableCell key={code} data-label={title}>
                        <Input
                          type="checkbox"
                          aria-label={`${o.name} — ${title}`}
                          checked={(picked[o.id] ?? []).includes(code)}
                          onChange={(e) => toggle(o.id, code, e.target.checked)}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {errors.model && (
            <span className="field-error" role="alert">
              {errors.model}
            </span>
          )}
          <h3>Mô hình cuối cùng</h3>
          <SupplyModelView stages={stages} name={name} />
        </fieldset>
        <div className="form-actions">
          <Button className="button" disabled={command.pending}>
            Tạo chuỗi truy xuất
          </Button>
        </div>
      </form>
      <InfoDialog
        open={review}
        title="Xác nhận tạo chuỗi truy xuất"
        description="Các tổ chức khác trong mô hình sẽ nhận lời mời tham gia chuỗi."
        rows={[
          ["Tên chuỗi", form.name.trim()],
          ["Loại chuỗi", chainTypeLabel(form.chainType)],
          ["Ngày bắt đầu", form.plannedStartDate || "—"],
          ["Số sản phẩm liên kết", String(productIds.length)],
        ]}
        onClose={() => setReview(false)}
        actions={
          <>
            <Button
              type="button"
              className="button secondary"
              disabled={command.pending}
              onClick={() => setReview(false)}
            >
              Quay lại sửa
            </Button>
            <Button
              type="button"
              className="button"
              disabled={command.pending}
              onClick={() => void confirm()}
            >
              {command.pending ? "Đang tạo…" : "Xác nhận tạo"}
            </Button>
          </>
        }
      >
        <SupplyModelView stages={stages} name={name} />
      </InfoDialog>
    </div>
  );
}
