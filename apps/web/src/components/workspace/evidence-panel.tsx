"use client";

import { useRef, useState, type FormEvent } from "react";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { useWorkspaceData, errorMessage, type Items, type Overview, type TraceEvidence } from "@/lib/workspace";
import { LoadState } from "@/components/manage";

const categories: Record<string, { value: string; label: string; minimum?: number }[]> = {
  CHAIN: [{ value: "CHAIN_IMAGE", label: "Ảnh chuỗi truy xuất" }],
  SITE_TRANSFER: [{ value: "TRANSFER_IMAGE", label: "Ảnh / chứng từ chuyển kho" }, { value: "OTHER", label: "Tệp khác" }],
  QUARANTINE: [{ value: "QUARANTINE_IMAGE", label: "Ảnh minh chứng cách ly" }, { value: "INSPECTION_IMAGE", label: "Giấy kiểm định" }, { value: "CERTIFICATE_IMAGE", label: "Giấy chứng nhận" }],
  PRODUCT: [{ value: "PRODUCT_IMAGE", label: "Ảnh sản phẩm", minimum: 3 }, { value: "INSPECTION_IMAGE", label: "Ảnh kiểm định" }],
  FARM: [
    { value: "AREA_IMAGE", label: "Ảnh vùng sản xuất", minimum: 1 },
    { value: "LAND_CERTIFICATE", label: "Giấy chứng nhận đất đai", minimum: 1 },
    { value: "PRODUCTION_CONTRACT", label: "Hợp đồng liên kết sản xuất", minimum: 1 },
    { value: "QUALITY_CERTIFICATE", label: "Giấy chứng nhận chất lượng", minimum: 1 },
    { value: "INSPECTION_IMAGE", label: "Giấy kiểm định / kiểm nghiệm", minimum: 1 },
    { value: "OTHER", label: "Ảnh khác" },
  ],
  SITE: [{ value: "SITE_IMAGE", label: "Ảnh cơ sở", minimum: 1 }, { value: "BUSINESS_LICENSE", label: "Giấy phép kinh doanh" }, { value: "QUALITY_CERTIFICATE", label: "Chứng nhận chất lượng" }, { value: "INSPECTION_IMAGE", label: "Giấy kiểm định / kiểm nghiệm" }],
  MATERIAL: [{ value: "MATERIAL_IMAGE", label: "Ảnh vật tư" }, { value: "SEED_IMAGE", label: "Ảnh giống" }, { value: "CERTIFICATE_IMAGE", label: "Ảnh chứng nhận" }, { value: "INSPECTION_IMAGE", label: "Ảnh kiểm định" }],
  CYCLE_DRAFT: [{ value: "CYCLE_IMAGE", label: "Ảnh vụ sản xuất" }, { value: "CERTIFICATE_IMAGE", label: "Chứng nhận / kiểm định" }],
  CYCLE: [{ value: "CYCLE_IMAGE", label: "Ảnh vụ sản xuất" }, { value: "CARE_IMAGE", label: "Ảnh nhật ký chăm sóc" }, { value: "HARVEST_IMAGE", label: "Ảnh thu hoạch" }, { value: "LOT_IMAGE", label: "Ảnh lô sau thu hoạch" }, { value: "CERTIFICATE_IMAGE", label: "Chứng nhận / kiểm định" }],
  LOT: [{ value: "LOT_IMAGE", label: "Ảnh lô nông sản", minimum: 1 }, { value: "LOT_DOCUMENT", label: "Giấy tờ liên quan" }, { value: "INSPECTION_IMAGE", label: "Ảnh kiểm định" }],
  TRANSFER: [{ value: "TRANSFER_IMAGE", label: "Ảnh / chứng từ giao nhận" }, { value: "INSPECTION_IMAGE", label: "Giấy kiểm định" }],
  PROFILE: [{ value: "BUSINESS_LICENSE", label: "Giấy phép kinh doanh" }, { value: "CERTIFICATE_IMAGE", label: "Giấy chứng nhận" }],
  MEMBER: [{ value: "MEMBER_AVATAR", label: "Ảnh đại diện" }, { value: "MEMBER_DOCUMENT", label: "Giấy tờ / chứng nhận chuyên môn" }],
  EXTERNAL_PARTNER: [{ value: "PARTNER_LOGO", label: "Logo doanh nghiệp" }, { value: "BUSINESS_LICENSE", label: "Giấy phép kinh doanh" }, { value: "CERTIFICATE_IMAGE", label: "Giấy chứng nhận" }, { value: "INSPECTION_IMAGE", label: "Giấy kiểm định / kiểm nghiệm" }],
};
const imageOnlyKinds = new Set(["QUARANTINE_IMAGE", "PRODUCT_IMAGE", "INSPECTION_IMAGE", "AREA_IMAGE", "LAND_CERTIFICATE", "PRODUCTION_CONTRACT", "QUALITY_CERTIFICATE", "CYCLE_IMAGE", "MATERIAL_IMAGE", "SEED_IMAGE", "CERTIFICATE_IMAGE", "LOT_IMAGE", "SITE_IMAGE", "TRANSFER_IMAGE", "HARVEST_IMAGE", "CARE_IMAGE", "PARTNER_LOGO", "MEMBER_AVATAR", "CHAIN_IMAGE"]);

export function EvidencePanel({ entityType, entityId, siteId, allowPublic = false, materialKind, onUploaded }: { entityType: string; entityId: string; siteId?: string; allowPublic?: boolean; materialKind?: string; onUploaded?: () => void }) {
  const auth = useAuth();
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const scope = new URLSearchParams({ entityType, entityId, ...(siteId ? { siteId } : {}) });
  const state = useWorkspaceData<Items<TraceEvidence>>(`/enterprise-workspace/evidence?${scope}`);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [kind, setKind] = useState(categories[entityType]?.[0]?.value ?? "OTHER");
  const attempt = useRef<{ key: string; body: FormData; userId: string } | null>(null);
  const options = (categories[entityType] ?? [{ value: "OTHER", label: "Chứng cứ khác" }]).map((option) => entityType === "MATERIAL" && option.value === (materialKind === "SEED" ? "SEED_IMAGE" : "MATERIAL_IMAGE") ? { ...option, minimum: 1 } : option);
  const current = (state.data?.items ?? []).filter((row) => !state.data?.items.some((newer) => newer.supersedesId === row.id));

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !auth.user) return;
    if (!attempt.current) {
      const body = new FormData(event.currentTarget);
      if (body.get("supersedesId") === "") body.delete("supersedesId");
      const file = body.get("file");
      if (!(file instanceof File) || file.size > 5 * 1024 * 1024) {
        setError("Chọn file PNG, JPEG hoặc PDF tối đa 5 MB.");
        return;
      }
      attempt.current = { key: crypto.randomUUID(), body, userId: auth.user.id };
    }
    if (attempt.current.userId !== auth.user.id) {
      setError("Phiên đăng nhập đã đổi; quay lại tài khoản tạo yêu cầu để đối soát.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await request("/enterprise-workspace/evidence", { method: "POST", headers: { "idempotency-key": attempt.current.key }, body: attempt.current.body });
      attempt.current = null;
      setUncertain(false);
      state.reload();
      onUploaded?.();
    } catch (cause) {
      setError(errorMessage(cause));
      const status = (cause as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 408) {
        attempt.current = null;
        setUncertain(false);
      } else setUncertain(true);
    } finally { setPending(false); }
  }

  async function download(id: string) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const file = await request<{ fileName: string; mediaType: string; contentBase64: string; sha256: string }>(`/enterprise-workspace/evidence/${id}/content`);
      const bytes = Uint8Array.from(atob(file.contentBase64), (char) => char.charCodeAt(0));
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      if (digest !== file.sha256) throw new Error("File không khớp hash chứng cứ");
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setPending(false); }
  }

  if (!overview.data?.permissions.includes("evidence.read")) return null;
  return <section className="panel evidence-panel">
    <h2>Ảnh và tài liệu chứng minh</h2>
    <p className="muted">File PNG, JPEG hoặc PDF, tối đa 5 MB mỗi file. Tài liệu nội bộ chỉ hiển thị theo quyền.</p>
    <LoadState {...state} />
    {error && <p className="notice error" role="alert">{error}{uncertain ? " Giữ nguyên file và mã yêu cầu; thử lại yêu cầu cũ để đối soát." : ""}</p>}
    {state.data && <ul className="evidence-requirements">{options.filter((option) => option.minimum).map((option) => {
      const count = current.filter((row) => row.kind === option.value).length;
      return <li key={option.value} data-complete={count >= (option.minimum ?? 0)}><strong>{option.label}</strong><span>{count}/{option.minimum} file tối thiểu</span></li>;
    })}</ul>}
    <ul className="evidence-files">{state.data?.items.map((row) => <li key={row.id}>
      <button type="button" className="text-link" disabled={pending} onClick={() => void download(row.id)}>{row.fileName}</button>
      <span>{options.find((option) => option.value === row.kind)?.label ?? "Chứng cứ chưa phân loại"} · {row.description} · {row.public ? "Công khai trên QR" : "Nội bộ"}{row.supersedesId ? " · Bản đính chính" : ""}</span>
    </li>)}</ul>
    {overview.data.permissions.includes("evidence.manage") && <form onSubmit={upload} className="workspace-form">
      <input type="hidden" name="entityType" value={entityType} /><input type="hidden" name="entityId" value={entityId} />
      {siteId && <input type="hidden" name="siteId" value={siteId} />}
      <fieldset disabled={pending || uncertain} className="enterprise-fields">
        <label>Loại ảnh / chứng từ<select className="input" name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>File chứng cứ<input className="input" type="file" name="file" accept={imageOnlyKinds.has(kind) ? "image/png,image/jpeg" : "image/png,image/jpeg,application/pdf"} required /></label>
        <label>Mô tả / căn cứ<textarea className="input" name="description" required minLength={10} maxLength={1000} /></label>
        <label>Đính chính bản trước (nếu có)<select className="input" name="supersedesId" defaultValue=""><option value="">Chứng cứ mới</option>{current.filter((row) => row.kind === kind).map((row) => <option key={row.id} value={row.id}>{row.fileName}</option>)}</select></label>
        {allowPublic && <><label><input type="checkbox" name="public" value="true" />Công khai trên QR của lô nguồn</label><label><input type="checkbox" name="publicationConfirmed" value="true" />Tôi đã kiểm tra file phù hợp công bố và không chứa thông tin liên hệ hoặc giấy tờ cá nhân</label></>}
      </fieldset>
      <button className="button" disabled={pending}>{uncertain ? "Thử lại yêu cầu cũ" : "Bổ sung chứng cứ"}</button>
    </form>}
  </section>;
}

/** Upload slots offered while creating a record, one per evidence kind. */
export function evidenceOptions(entityType: string, materialKind?: string) {
  return (categories[entityType] ?? []).map((option) =>
    entityType === "MATERIAL" && option.value === (materialKind === "SEED" ? "SEED_IMAGE" : "MATERIAL_IMAGE")
      ? { ...option, minimum: 1 }
      : option,
  );
}

const MAX_FILE = 5 * 1024 * 1024;

/** File pickers for a create form. Files are sent with `uploadEvidenceFiles`
 * once the record exists; kinds with a minimum are required here. */
export function EvidenceInputs({ entityType, title = "Ảnh và giấy tờ", disabled = false }: { entityType: string; title?: string; disabled?: boolean }) {
  const options = evidenceOptions(entityType);
  if (!options.length) return null;
  return (
    <fieldset className="enterprise-fields evidence-inputs" disabled={disabled}>
      <legend>{title}</legend>
      <p className="muted">PNG hoặc JPEG{options.some((o) => !imageOnlyKinds.has(o.value)) ? " (giấy tờ nhận cả PDF)" : ""}, tối đa 5 MB mỗi file. Ảnh được lưu ngay sau khi tạo.</p>
      {options.map((option) => (
        <label key={option.value}>
          {option.label}
          {option.minimum ? ` (tối thiểu ${option.minimum})` : " (không bắt buộc)"}
          <input
            className="input"
            type="file"
            multiple
            name={`evidence:${option.value}`}
            data-minimum={option.minimum ?? 0}
            data-label={option.label}
            accept={imageOnlyKinds.has(option.value) ? "image/png,image/jpeg" : "image/png,image/jpeg,application/pdf"}
            required={!!option.minimum}
          />
        </label>
      ))}
    </fieldset>
  );
}

/** Checks the pickers before the record is created; returns an error or "". */
export function checkEvidenceInputs(form: HTMLFormElement) {
  for (const input of form.querySelectorAll<HTMLInputElement>('input[type="file"][name^="evidence:"]')) {
    const files = [...(input.files ?? [])];
    const minimum = Number(input.dataset.minimum ?? 0);
    if (files.length < minimum) return `${input.dataset.label}: cần ít nhất ${minimum} file.`;
    if (files.some((file) => file.size > MAX_FILE)) return `${input.dataset.label}: mỗi file tối đa 5 MB.`;
  }
  return "";
}

/** Sends every picked file as evidence of the new record. Failures are
 * reported, not retried; the record's detail page lists what arrived. */
export async function uploadEvidenceFiles(form: HTMLFormElement, entityType: string, entityId: string) {
  const failed: string[] = [];
  for (const input of form.querySelectorAll<HTMLInputElement>('input[type="file"][name^="evidence:"]')) {
    const kind = input.name.slice("evidence:".length);
    for (const file of input.files ?? []) {
      const body = new FormData();
      body.set("entityType", entityType);
      body.set("entityId", entityId);
      body.set("kind", kind);
      body.set("file", file);
      body.set("description", `${input.dataset.label ?? kind} — tải lên khi tạo mới`);
      try {
        await request("/enterprise-workspace/evidence", {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body,
        });
      } catch {
        failed.push(file.name);
      }
    }
  }
  return failed;
}

/** Id of a record returned by a create command, whatever its envelope. */
export function createdId(result: unknown): string | null {
  const row = result as { id?: unknown; record?: { id?: unknown }; item?: { id?: unknown } } | null;
  const id = row?.id ?? row?.record?.id ?? row?.item?.id;
  return typeof id === "string" ? id : null;
}

/** Version of a record returned by a create command, for the completion step. */
export function createdVersion(result: unknown): number {
  const row = result as { version?: unknown; record?: { version?: unknown } } | null;
  const version = row?.version ?? row?.record?.version;
  return typeof version === "number" ? version : 0;
}

/** Marks a new record's evidence complete (which activates it). The API checks
 * the required photos again; on refusal the record stays inactive. */
export async function completeEvidence(path: string, version: number) {
  try {
    await request(path, {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ version }),
    });
    return "";
  } catch (cause) {
    return errorMessage(cause);
  }
}
