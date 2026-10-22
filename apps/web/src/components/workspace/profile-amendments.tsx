"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import {
  useWorkspaceData,
  useWorkspaceCommand,
  errorMessage,
  textValue,
  labels,
  type EnterpriseProfile,
  type Items,
  type OwnProfileWorkspace,
  type ProfileAmendment,
  type RecordOf,
  type TraceEvidence,
} from "@/lib/workspace";
import {
  ACTIVITY_OPTIONS,
  CERTIFICATION_OPTIONS,
  LEGAL_FORM_OPTIONS,
  registeredLegalForm,
} from "@/lib/registration-form";
import type { AddressProvince } from "@/lib/registration-form";
import { CommandState, LoadState } from "@/components/manage";

/** Effective legal data keeps the shape written by registration and approvals. */
type LegalData = {
  businessId?: string | null;
  registrationNumber?: string | null;
  representativeTitle?: string | null;
  production?: {
    productGroups?: string[];
    certifications?: string[];
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};
const amendmentLabels: Record<string, string> = {
  PENDING: "Chờ admin duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Bị từ chối",
  WITHDRAWN: "Đã rút",
};
const date = (value: unknown) =>
  value ? new Date(String(value)).toLocaleString("vi-VN") : "—";

/** Legal data and capabilities change only through an admin-reviewed amendment;
 * contact and description keep a revision trail and apply immediately. */
export function ProfileAmendments() {
  const state = useWorkspaceData<RecordOf<OwnProfileWorkspace>>(
    "/enterprise-workspace/profile",
  );
  const data = state.data?.record;
  // Bumped after each legal document upload so the amendment form lists it.
  const [documents, setDocuments] = useState(0);
  return (
    <>
      <LoadState {...state} />
      {data?.profile && (
        <>
          <ContactForm profile={data.profile} onSaved={state.reload} />
          <ProfileEvidence
            organizationId={data.organization.id}
            onUploaded={() => setDocuments((n) => n + 1)}
          />
          <AmendmentForm
            name={data.organization.name}
            profile={data.profile}
            organizationId={data.organization.id}
            blocked={data.amendments.some((a) => a.status === "PENDING")}
            documents={documents}
            onSaved={state.reload}
          />
          <AmendmentList rows={data.amendments} onSaved={state.reload} />
          <section className="panel">
            <h2>Lịch sử phiên bản hồ sơ</h2>
            {data.history.length ? (
              <ul>
                {data.history.map((h) => (
                  <li key={h.id}>
                    Phiên bản {h.version} · {date(h.createdAt)} · {h.reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Chưa có thay đổi sau đăng ký.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}

function ContactForm({
  profile,
  onSaved,
}: {
  profile: EnterpriseProfile;
  onSaved(): void;
}) {
  const cmd = useWorkspaceCommand();
  const [saved, setSaved] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    const input = {
      version: Number(profile.version),
      reason: form.reason.trim(),
      phone: form.phone.trim(),
      contactEmail: form.contactEmail.trim(),
      description: form.description.trim(),
      ...(form.website.trim() ? { website: form.website.trim() } : {}),
    };
    setSaved(false);
    if (await cmd.run("/enterprise-workspace/profile/contact", input)) {
      setSaved(true);
      onSaved();
    }
  }
  return (
    <form className="panel workspace-form" onSubmit={submit}>
      <h2>Liên hệ và giới thiệu</h2>
      <p className="muted">
        Thay đổi được gửi quản trị AgriTrace duyệt trước khi áp dụng; hồ sơ
        hiện hành giữ nguyên tới khi được duyệt. Đổi tên, mã pháp lý, người đại
        diện hoặc hoạt động dùng mẫu điều chỉnh pháp lý bên dưới.
      </p>
      <CommandState command={cmd} />
      {saved && (
        <p className="notice" role="status">
          Đã gửi yêu cầu điều chỉnh liên hệ. Theo dõi kết quả trong danh sách
          hồ sơ điều chỉnh bên dưới.
        </p>
      )}
      <fieldset
        disabled={cmd.pending || cmd.frozen}
        className="enterprise-fields"
        key={String(profile.version)}
      >
        <label>
          Điện thoại
          <Input
            className="input"
            name="phone"
            required
            minLength={5}
            maxLength={30}
            defaultValue={String(profile.phone ?? "")}
          />
        </label>
        <label>
          Email liên hệ
          <Input
            className="input"
            name="contactEmail"
            type="email"
            required
            maxLength={255}
            defaultValue={String(profile.contactEmail ?? "")}
          />
        </label>
        <label>
          Website (không bắt buộc)
          <Input
            className="input"
            name="website"
            type="url"
            maxLength={255}
            defaultValue={String(profile.website ?? "")}
          />
        </label>
        <label>
          Giới thiệu
          <Textarea
            className="input"
            name="description"
            maxLength={2000}
            defaultValue={String(profile.description ?? "")}
          />
        </label>
        <label>
          Lý do thay đổi
          <Textarea
            className="input"
            name="reason"
            required
            minLength={10}
            maxLength={1000}
          />
        </label>
      </fieldset>
      <Button className="button" disabled={cmd.pending}>
        {"Gửi admin duyệt"}
      </Button>
    </form>
  );
}

/** Private legal evidence; never published on QR. */
function ProfileEvidence({
  organizationId,
  onUploaded,
}: {
  organizationId: string;
  onUploaded(): void;
}) {
  const auth = useAuth();
  const scope = new URLSearchParams({
    entityType: "PROFILE",
    entityId: organizationId,
  });
  const state = useWorkspaceData<Items<TraceEvidence>>(
    `/enterprise-workspace/evidence?${scope}`,
  );
  const attempt = useRef<{
    key: string;
    body: FormData;
    userId: string;
  } | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !auth.user) return;
    const form = e.currentTarget;
    if (!attempt.current)
      attempt.current = {
        key: crypto.randomUUID(),
        body: new FormData(form),
        userId: auth.user.id,
      };
    if (attempt.current.userId !== auth.user.id) {
      setError(
        "Phiên đăng nhập đã đổi; quay lại tài khoản tạo yêu cầu để đối soát.",
      );
      return;
    }
    setPending(true);
    setError("");
    try {
      await request("/enterprise-workspace/evidence", {
        method: "POST",
        headers: { "idempotency-key": attempt.current.key },
        body: attempt.current.body,
      });
      attempt.current = null;
      setUncertain(false);
      form.reset();
      state.reload();
      onUploaded();
    } catch (cause) {
      setError(errorMessage(cause));
      const status = (cause as { status?: number }).status;
      if (
        !uncertain &&
        status &&
        status >= 400 &&
        status < 500 &&
        status !== 408
      ) {
        attempt.current = null;
        setUncertain(false);
      } else setUncertain(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel">
      <h2>Giấy tờ pháp lý riêng tư</h2>
      <p className="muted">
        Chỉ admin xét duyệt và người quản lý hồ sơ của tổ chức xem được. Không
        hiển thị trên QR.
      </p>
      <LoadState {...state} />
      {error && (
        <p className="notice error" role="alert">
          {error}
          {uncertain
            ? " Giữ nguyên file và mã yêu cầu; thử lại yêu cầu cũ để đối soát."
            : ""}
        </p>
      )}
      <ul>
        {state.data?.items.map((r) => (
          <li key={String(r.id)}>
            {textValue(r.fileName)} · {textValue(r.description)} ·{" "}
            {date(r.createdAt)}
          </li>
        ))}
      </ul>
      <form onSubmit={upload} className="workspace-form">
        <Input type="hidden" name="entityType" value="PROFILE" />
        <Input type="hidden" name="entityId" value={organizationId} />
        <fieldset disabled={pending || uncertain} className="enterprise-fields">
          <label>
            File PNG, JPEG hoặc PDF, tối đa 5 MB
            <Input
              className="input"
              type="file"
              name="file"
              accept="image/png,image/jpeg,application/pdf"
              required
            />
          </label>
          <label>
            Mô tả giấy tờ
            <Textarea
              className="input"
              name="description"
              required
              minLength={10}
              maxLength={1000}
            />
          </label>
        </fieldset>
        <Button className="button secondary" disabled={pending}>
          {"Tải giấy tờ"}
        </Button>
      </form>
    </section>
  );
}

function AmendmentForm({
  name,
  profile,
  organizationId,
  blocked,
  documents,
  onSaved,
}: {
  name: string;
  profile: EnterpriseProfile;
  organizationId: string;
  blocked: boolean;
  documents: number;
  onSaved(): void;
}) {
  const cmd = useWorkspaceCommand();
  const legal: LegalData = profile.legalData;
  const production = legal.production ?? {};
  const evidence = useWorkspaceData<Items<TraceEvidence>>(
    `/enterprise-workspace/evidence?${new URLSearchParams({ entityType: "PROFILE", entityId: organizationId })}`,
  );
  const reloadEvidence = evidence.reload;
  useEffect(() => {
    if (documents) reloadEvidence();
  }, [documents, reloadEvidence]);
  const [addresses, setAddresses] = useState<AddressProvince[]>([]);
  const [legalForm, setLegalForm] = useState(
    String(profile.legalForm ?? "ENTERPRISE"),
  );
  const [provinceCode, setProvinceCode] = useState(
    String(profile.provinceCode ?? ""),
  );
  const [activities, setActivities] = useState<string[]>(
    profile.activities,
  );
  const [sent, setSent] = useState(false);
  useEffect(() => {
    request<AddressProvince[]>("/reference-data/addresses", undefined, false)
      .then(setAddresses)
      .catch(() => setAddresses([]));
  }, []);
  const province = addresses.find((p) => p.code === provinceCode);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const text = (key: string) => String(fd.get(key) ?? "").trim();
    const optional = (key: string) => (text(key) ? text(key) : undefined);
    const farm = activities.includes("FARM");
    const input = {
      version: Number(profile.version),
      reason: text("reason"),
      evidenceIds: fd.getAll("evidenceIds").map(String),
      profile: {
        name: text("name"),
        legalForm,
        businessId: optional("businessId"),
        registrationNumber: optional("registrationNumber"),
        representativeTitle: optional("representativeTitle"),
        address: text("address"),
        provinceCode,
        wardCode: text("wardCode"),
        representative: text("representative"),
        activities,
        ...(farm
          ? {
              production: {
                sector: "CROP",
                productGroups: text("productGroups")
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                growingAreaCode: optional("growingAreaCode"),
                packingFacilityCode: optional("packingFacilityCode"),
                scaleEstimate: optional("scaleEstimate"),
                ...(text("facilityCount")
                  ? { facilityCount: Number(text("facilityCount")) }
                  : {}),
                certifications: fd.getAll("certifications").map(String),
              },
            }
          : {}),
      },
    };
    setSent(false);
    if (await cmd.run("/enterprise-workspace/profile/amendments", input)) {
      setSent(true);
      onSaved();
    }
  }
  if (blocked)
    return (
      <section className="panel">
        <h2>Điều chỉnh thông tin pháp lý</h2>
        <p className="notice">
          Đang có hồ sơ điều chỉnh chờ admin duyệt. Thông tin đang hiệu lực được
          giữ nguyên đến khi có quyết định.
        </p>
      </section>
    );
  return (
    <form className="panel workspace-form" onSubmit={submit}>
      <h2>Điều chỉnh thông tin pháp lý</h2>
      <p className="muted">
        Tên, loại hình, mã pháp lý, địa chỉ, người đại diện và hoạt động cần
        admin duyệt lại. Lịch sử lô và chứng cứ đã ghi không đổi theo hồ sơ mới.
        Bỏ một hoạt động chỉ được duyệt khi tổ chức không còn tồn, giao nhận
        hoặc chuỗi đang mở.
      </p>
      <CommandState command={cmd} />
      {sent && (
        <p className="notice" role="status">
          Đã gửi hồ sơ điều chỉnh. Thông tin hiện hành vẫn giữ nguyên đến khi
          admin duyệt.
        </p>
      )}
      <fieldset
        disabled={cmd.pending || cmd.frozen}
        className="enterprise-fields"
        key={String(profile.version)}
      >
        <label>
          Tên tổ chức
          <Input
            className="input"
            name="name"
            required
            minLength={2}
            maxLength={255}
            defaultValue={name}
          />
        </label>
        <label>
          Loại hình
          <NativeSelect
            className="input"
            value={legalForm}
            onChange={(e) => setLegalForm(e.target.value)}
          >
            {LEGAL_FORM_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          Mã số thuế / mã hộ kinh doanh
          {registeredLegalForm(legalForm) ? "" : " (không bắt buộc)"}
          <Input
            className="input"
            name="businessId"
            maxLength={40}
            inputMode="numeric"
            required={registeredLegalForm(legalForm)}
            defaultValue={String(legal.businessId ?? "")}
          />
        </label>
        {registeredLegalForm(legalForm) && (
          <>
            <label>
              Số giấy đăng ký
              <Input
                className="input"
                name="registrationNumber"
                required
                maxLength={100}
                defaultValue={String(legal.registrationNumber ?? "")}
              />
            </label>
            <label>
              Chức vụ người đại diện
              <Input
                className="input"
                name="representativeTitle"
                required
                maxLength={100}
                defaultValue={String(legal.representativeTitle ?? "")}
              />
            </label>
          </>
        )}
        <label>
          Người đại diện
          <Input
            className="input"
            name="representative"
            required
            minLength={2}
            maxLength={255}
            defaultValue={String(profile.representative ?? "")}
          />
        </label>
        <label>
          Tỉnh / thành phố
          <NativeSelect
            className="input"
            value={provinceCode}
            onChange={(e) => setProvinceCode(e.target.value)}
            required
          >
            <option value="">Chọn tỉnh / thành phố</option>
            {addresses.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          Xã / phường
          <NativeSelect
            className="input"
            name="wardCode"
            required
            defaultValue={String(profile.wardCode ?? "")}
            key={provinceCode}
          >
            <option value="">Chọn xã / phường</option>
            {province?.wards.map((w) => (
              <option key={w.code} value={w.code}>
                {w.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          Địa chỉ
          <Input
            className="input"
            name="address"
            required
            minLength={5}
            maxLength={500}
            defaultValue={String(profile.address ?? "")}
          />
        </label>
        <fieldset className="enterprise-fields">
          <legend>Hoạt động đề nghị</legend>
          {ACTIVITY_OPTIONS.map(([value, label]) => (
            <label key={value}>
              <Input
                type="checkbox"
                checked={activities.includes(value)}
                onChange={(e) =>
                  setActivities((current) =>
                    e.target.checked
                      ? [...current, value]
                      : current.filter((c) => c !== value),
                  )
                }
              />{" "}
              {label}
            </label>
          ))}
        </fieldset>
        {activities.includes("FARM") && (
          <fieldset className="enterprise-fields">
            <legend>Sản xuất trồng trọt</legend>
            <label>
              Nhóm sản phẩm (cách nhau bằng dấu phẩy)
              <Input
                className="input"
                name="productGroups"
                required
                defaultValue={(
                  production.productGroups ?? []
                ).join(", ")}
              />
            </label>
            <label>
              Mã vùng trồng
              <Input
                className="input"
                name="growingAreaCode"
                maxLength={100}
                defaultValue={String(production.growingAreaCode ?? "")}
              />
            </label>
            <label>
              Mã cơ sở đóng gói
              <Input
                className="input"
                name="packingFacilityCode"
                maxLength={100}
                defaultValue={String(production.packingFacilityCode ?? "")}
              />
            </label>
            <label>
              Quy mô ước tính
              <Input
                className="input"
                name="scaleEstimate"
                maxLength={200}
                defaultValue={String(production.scaleEstimate ?? "")}
              />
            </label>
            <label>
              Số cơ sở
              <Input
                className="input"
                name="facilityCount"
                type="number"
                min={1}
                max={10000}
                defaultValue={
                  production.facilityCount
                    ? String(production.facilityCount)
                    : ""
                }
              />
            </label>
            {CERTIFICATION_OPTIONS.map(([value, label]) => (
              <label key={value}>
                <Input
                  type="checkbox"
                  name="certifications"
                  value={value}
                  defaultChecked={(
                    production.certifications ?? []
                  ).includes(value)}
                />{" "}
                {label}
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="enterprise-fields">
          <legend>Giấy tờ chứng minh (chọn 1–8)</legend>
          {evidence.data?.items.length ? (
            evidence.data.items.map((r) => (
              <label key={String(r.id)}>
                <Input
                  type="checkbox"
                  name="evidenceIds"
                  value={String(r.id)}
                />{" "}
                {textValue(r.fileName)} · {textValue(r.description)}
              </label>
            ))
          ) : (
            <p className="muted">
              Chưa có giấy tờ. Tải giấy tờ ở mục “Giấy tờ pháp lý riêng tư”
              phía trên, danh sách sẽ tự cập nhật.
            </p>
          )}
        </fieldset>
        <label>
          Lý do điều chỉnh
          <Textarea
            className="input"
            name="reason"
            required
            minLength={10}
            maxLength={1000}
          />
        </label>
      </fieldset>
      <Button
        className="button"
        disabled={
          cmd.pending || !evidence.data?.items.length || !activities.length
        }
      >
        {"Gửi admin duyệt"}
      </Button>
    </form>
  );
}

function AmendmentList({
  rows,
  onSaved,
}: {
  rows: ProfileAmendment[];
  onSaved(): void;
}) {
  const cmd = useWorkspaceCommand();
  const [selected, setSelected] = useState<ProfileAmendment | null>(null);
  async function withdraw(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const reason = String(
      new FormData(e.currentTarget).get("reason") ?? "",
    ).trim();
    if (
      await cmd.run(
        `/enterprise-workspace/profile/amendments/${selected.id}/withdraw`,
        {
          version: Number(selected.version),
          reason,
        },
      )
    ) {
      setSelected(null);
      onSaved();
    }
  }
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>Hồ sơ điều chỉnh đã gửi</h2>
      <CommandState command={cmd} />
      <ul>
        {rows.map((r) => {
          const target = r.target;
          return (
            <li key={r.id}>
              {date(r.createdAt)} · {target.name} ·{" "}
              {target.activities
                .map((a) => labels[a] ?? a)
                .join(", ")}{" "}
              ·{" "}
              <strong>
                {amendmentLabels[r.status] ?? r.status}
              </strong>
              {r.reviewNote ? ` · Ghi chú: ${r.reviewNote}` : ""}
              {r.status === "PENDING" && (
                <>
                  {" "}
                  <Button
                    type="button"
                    className="text-link"
                    onClick={() => setSelected(r)}
                  >
                    Rút hồ sơ
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {selected && (
        <form className="workspace-form" onSubmit={withdraw}>
          <fieldset
            disabled={cmd.pending || cmd.frozen}
            className="enterprise-fields"
          >
            <label>
              Lý do rút hồ sơ
              <Textarea
                className="input"
                name="reason"
                required
                minLength={10}
                maxLength={1000}
              />
            </label>
          </fieldset>
          <div className="workspace-actions">
            <Button className="button secondary" disabled={cmd.pending}>
              {"Xác nhận rút"}
            </Button>
            <Button
              type="button"
              className="text-link"
              disabled={cmd.frozen}
              onClick={() => setSelected(null)}
            >
              Hủy
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
