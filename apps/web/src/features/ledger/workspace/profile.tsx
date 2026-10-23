"use client";

import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { Controller, useWatch, type Control } from "react-hook-form";
import { z } from "zod";
import { certificationsForApi } from "@/lib/ledger/workspace-protocol";
import { wapi } from "@/lib/ledger/workspace-api";
import type { AddressProvince, EnterpriseProfile, Evidence, ProfileAmendment, ProductionDetails, Revision } from "@/lib/ledger/workspace-types";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { useAuth } from "@/lib/auth-store";
import { fmtDateTime } from "@/lib/ledger/format";
import { localized, t as tr } from "@/lib/ledger/i18n";
import { CAPABILITY_LABEL } from "@/lib/ledger/labels";
import { Button } from "@/components/ledger/ui/button";
import { Checkbox } from "@/components/ledger/ui/checkbox";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader, Section } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { EvidencePanel } from "@/components/ledger/workspace/evidence-panel";
import { RevisionHistory } from "@/components/ledger/workspace/revision-history";

export const LEGAL_FORM_LABEL: Record<string, string> = localized({
  ENTERPRISE: "Doanh nghiệp",
  COOPERATIVE: "Hợp tác xã",
  HOUSEHOLD_BUSINESS: "Hộ kinh doanh",
  PRODUCER_HOUSEHOLD: "Hộ sản xuất",
  INDIVIDUAL_PRODUCER: "Cá nhân sản xuất",
});
const AMENDMENT_LABEL: Record<string, string> = localized({ PENDING: "Chờ nền tảng duyệt", APPROVED: "Đã duyệt", REJECTED: "Bị từ chối", WITHDRAWN: "Đã rút" });
const AMENDMENT_TONE: Record<string, "info" | "ok" | "danger" | "neutral"> = { PENDING: "info", APPROVED: "ok", REJECTED: "danger", WITHDRAWN: "neutral" };
const REGISTERED = ["ENTERPRISE", "COOPERATIVE", "HOUSEHOLD_BUSINESS"];
const ACTIVITIES = ["FARM", "TRANSPORTER", "DISTRIBUTOR", "RETAILER"];
const CERTS = ["VIETGAP", "GLOBALGAP", "ORGANIC", "OTHER"];
const reason = z.string().trim().min(10, { error: () => tr("Tối thiểu 10 ký tự") }).max(1000);

// ProfileContactInput (profile-amendments.ts)
const contactSchema = z.object({
  phone: z.string().trim().min(5, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 5 }) }).max(30),
  contactEmail: z.email({ error: () => tr("Email không hợp lệ") }).max(255),
  website: z.union([z.literal(""), z.url({ protocol: /^https?$/, error: () => tr("Website cần URL http(s) hợp lệ") }).max(255)]).optional(),
  description: z.string().max(2000),
  reason,
});
// SubmitProfileInput + LegalProfileInput
const legalSchema = z
  .object({
    name: z.string().trim().min(2, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 2 }) }).max(255),
    legalForm: z.enum(["ENTERPRISE", "COOPERATIVE", "HOUSEHOLD_BUSINESS", "PRODUCER_HOUSEHOLD", "INDIVIDUAL_PRODUCER"]),
    businessId: z.string().trim().max(40).optional(),
    registrationNumber: z.string().trim().max(100).optional(),
    representativeTitle: z.string().trim().max(100).optional(),
    address: z.string().trim().min(5, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 5 }) }).max(500),
    provinceCode: z.string().min(1, { error: () => tr("Chọn tỉnh/thành") }),
    wardCode: z.string().min(1, { error: () => tr("Chọn phường/xã") }),
    representative: z.string().trim().min(2, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 2 }) }).max(255),
    activities: z.array(z.enum(["FARM", "TRANSPORTER", "DISTRIBUTOR", "RETAILER"])).min(1, { error: () => tr("Chọn ít nhất một năng lực") }).max(4),
    growingAreaCode: z.string().max(100).optional(), packingFacilityCode: z.string().max(100).optional(), scaleEstimate: z.string().max(255).optional(), facilityCount: z.string().optional(),
    productGroups: z.string().max(1100).optional(),
    certifications: z.array(z.string()),
    evidenceIds: z.array(z.string()).min(1, { error: () => tr("Chọn ít nhất một chứng cứ pháp lý") }).max(8),
    reason,
  })
  .superRefine((v, ctx) => {
    const id = (v.businessId ?? "").replace(/[-\s]/g, "");
    if (id && !/^(?:\d{10}|\d{12}|\d{13})$/.test(id)) ctx.addIssue({ code: "custom", path: ["businessId"], message: tr("Mã pháp lý gồm 10, 12 hoặc 13 chữ số") });
    if (REGISTERED.includes(v.legalForm)) {
      if (!id) ctx.addIssue({ code: "custom", path: ["businessId"], message: tr("Bắt buộc với loại hình đã đăng ký") });
      if (!v.registrationNumber?.trim()) ctx.addIssue({ code: "custom", path: ["registrationNumber"], message: tr("Bắt buộc với loại hình đã đăng ký") });
      if (!v.representativeTitle?.trim()) ctx.addIssue({ code: "custom", path: ["representativeTitle"], message: tr("Bắt buộc với loại hình đã đăng ký") });
    }
    if (["ENTERPRISE", "COOPERATIVE"].includes(v.legalForm) && id.length === 12) ctx.addIssue({ code: "custom", path: ["businessId"], message: tr("Mã số 12 chữ số chỉ dành cho hộ kinh doanh") });
    if (["PRODUCER_HOUSEHOLD", "INDIVIDUAL_PRODUCER"].includes(v.legalForm) && !v.activities.includes("FARM")) ctx.addIssue({ code: "custom", path: ["activities"], message: tr("Hộ/cá nhân sản xuất cần năng lực sản xuất") });
    const groups = (v.productGroups ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (v.activities.includes("FARM") && (groups.length < 1 || groups.length > 10)) ctx.addIssue({ code: "custom", path: ["productGroups"], message: tr("Khai 1–10 nhóm sản phẩm, cách nhau bằng dấu phẩy") });
  });
const withdrawSchema = z.object({ reason });

export default function ProfilePage() {
  const { user } = useAuth();
  const { can } = useWorkspaceAccess();
  const q = useQuery({ queryKey: ["ws-profile"], queryFn: wapi.profile });
  const contact = useDialog();
  const legal = useDialog();
  const withdraw = useDialog<ProfileAmendment>();
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const p = d?.profile;
  const pending = d?.amendments.find((a) => a.status === "PENDING");
  const owner = d?.enrollment?.ownerId === user?.id;
  const canManage = owner || can("profile.manage");
  const invalidate = [["ws-profile"], ["ws-overview"]];
  return (
    <>
      <PageHeader
        title={tr("Hồ sơ doanh nghiệp")}
        description={tr("Thông tin pháp lý và liên hệ đang hiệu lực. Mọi thay đổi, kể cả liên hệ, đều gửi thành đề nghị để nền tảng duyệt; chỉ có một đề nghị chờ duyệt tại một thời điểm.")}
        actions={
          p && canManage && (
            <>
              <Button size="sm" variant="outline" onClick={() => contact.open(true)} disabled={!!pending}>{tr("Đề nghị đổi liên hệ")}</Button>
              <Button size="sm" onClick={() => legal.open(true)} disabled={!!pending}>{tr("Đề nghị điều chỉnh pháp lý")}</Button>
            </>
          )
        }
      />
      <PageBody>
        {!d ? (
          <LoadingRows rows={8} />
        ) : !p ? (
          <EmptyState title={tr("Tổ chức chưa có hồ sơ")} />
        ) : (
          <>
            {pending && (
              <Callout tone="info" title={tr("Đang có đề nghị chờ nền tảng duyệt")}>
                {tr("Rút đề nghị đó nếu muốn gửi bản khác.")}
              </Callout>
            )}
            <div className="grid min-w-0 grid-cols-1 gap-5 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <Section title={d.organization.name} aside={<span className="font-mono text-[11.5px]">v{p.version}</span>}>
                <ProfileFacts p={p} />
              </Section>
              <div className="flex flex-col gap-5">
                <Section title={tr("Hồ sơ đăng ký")}>
                  <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-3 text-[13px] sm:px-5">
                    <dt className="text-ink-2">{tr("Trạng thái")}</dt>
                    <dd>{d.enrollment?.status ?? "—"}</dd>
                    <dt className="text-ink-2">{tr("Mã số thuế")}</dt>
                    <dd className="font-mono">{d.enrollment?.businessId ?? "—"}</dd>
                    <dt className="text-ink-2">{tr("Người đứng tên")}</dt>
                    <dd>{owner ? tr("Bạn") : tr("Thành viên khác")}</dd>
                  </dl>
                </Section>
                <Section title={tr("Chứng cứ pháp lý")}>
                  <div className="px-4 py-3 sm:px-5">
                    <EvidencePanel entityType="PROFILE" entityId={d.organization.id} canManage={canManage} title={tr("Tệp riêng tư của tổ chức")} />
                  </div>
                </Section>
              </div>
            </div>
            <Section title={tr("Đề nghị đã gửi")}>
              <Amendments rows={d.amendments} myId={user?.id} onWithdraw={(a) => withdraw.open(a)} />
            </Section>
            <Section title={tr("Lịch sử phiên bản")}>
              <div className="px-4 py-3 sm:px-5">
                <RevisionHistory entityType="PROFILE" id={d.organization.id} rows={d.history as Revision[]} />
              </div>
            </Section>
          </>
        )}
      </PageBody>

      {p && contact.target && (
        <CommandDialog
          {...contact.props}
          title={tr("Đề nghị đổi thông tin liên hệ")}
          endpoint="POST /enterprise-workspace/profile/contact"
          description={tr("Đề nghị giữ nguyên mọi thông tin pháp lý, chỉ thay khối liên hệ. Email liên hệ không được trùng email đã dùng trong hệ thống.")}
          schema={contactSchema}
          defaultValues={{ phone: p.phone, contactEmail: p.contactEmail, website: p.website ?? "", description: p.description ?? "", reason: "" }}
          version={p.version}
          submitLabel={tr("Gửi đề nghị")}
          invalidate={invalidate}
          run={(v, cmd) => wapi.requestContactChange({ phone: v.phone, contactEmail: v.contactEmail, website: v.website || undefined, description: v.description, version: p.version, reason: v.reason }, cmd)}
        >
          {(f) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField control={f.control} name="phone" label={tr("Điện thoại")} />
                <TextField control={f.control} name="contactEmail" label={tr("Email liên hệ")} type="email" />
              </div>
              <TextField control={f.control} name="website" label={tr("Website (tùy chọn)")} placeholder="https://" />
              <TextAreaField control={f.control} name="description" label={tr("Giới thiệu doanh nghiệp")} max={2000} />
              <TextAreaField control={f.control} name="reason" label={tr("Lý do thay đổi")} max={1000} />
            </>
          )}
        </CommandDialog>
      )}
      {p && legal.target && <LegalDialog props={legal.props} profile={p} name={d!.organization.name} orgId={d!.organization.id} invalidate={invalidate} />}
      {withdraw.target && (
        <CommandDialog {...withdraw.props} title={tr("Rút đề nghị")} endpoint="POST /enterprise-workspace/profile/amendments/:id/withdraw" description={tr("Chỉ người gửi rút được đề nghị đang chờ duyệt.")} schema={withdrawSchema} defaultValues={{ reason: "" }} version={withdraw.target.version} tone="danger" submitLabel={tr("Rút đề nghị")} invalidate={invalidate} run={(v, cmd) => wapi.withdrawAmendment(withdraw.target!.id, { version: withdraw.target!.version, reason: v.reason }, cmd)}>
          {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />}
        </CommandDialog>
      )}
    </>
  );
}

function ProfileFacts({ p }: { p: EnterpriseProfile }) {
  const prod = p.legalData.production;
  const rows: [string, React.ReactNode][] = [
    [tr("Loại hình"), LEGAL_FORM_LABEL[p.legalForm] ?? p.legalForm],
    [tr("Mã số thuế"), p.legalData.businessId && <span className="font-mono">{p.legalData.businessId}</span>],
    [tr("Số đăng ký kinh doanh"), p.legalData.registrationNumber],
    [tr("Người đại diện"), [p.representative, p.legalData.representativeTitle].filter(Boolean).join(" · ")],
    [tr("Địa chỉ"), [p.address, p.ward, p.province].filter(Boolean).join(", ")],
    [tr("Năng lực"), <span key="a" className="flex flex-wrap gap-1">{p.activities.map((a) => <Badge key={a} tone="neutral" dot={false}>{CAPABILITY_LABEL[a] ?? a}</Badge>)}</span>],
    [tr("Sản xuất"), prod && `${prod.productGroups.join(", ")}${prod.certifications.length ? ` · ${prod.certifications.join(", ")}` : ""}${prod.growingAreaCode ? ` · ${prod.growingAreaCode}` : ""}`],
    [tr("Điện thoại"), p.phone],
    [tr("Email liên hệ"), p.contactEmail],
    ["Website", p.website],
    [tr("Giới thiệu"), p.description],
  ];
  return (
    <dl className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 text-[13px] sm:px-5">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-2">{k}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function Amendments({ rows, myId, onWithdraw }: { rows: ProfileAmendment[]; myId?: string; onWithdraw: (a: ProfileAmendment) => void }) {
  if (!rows.length) return <EmptyState title={tr("Chưa gửi đề nghị nào")} />;
  return (
    <ul className="divide-y divide-line/70">
      {rows.map((a) => {
        const label = AMENDMENT_LABEL[a.status] ?? a.status;
        const tone = AMENDMENT_TONE[a.status] ?? "neutral";
        const legal = a.evidenceIds.length > 0;
        return (
          <li key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone={tone}>{label}</Badge>
                <Badge tone="neutral" dot={false}>{legal ? tr("Pháp lý") : tr("Liên hệ")}</Badge>
                <span className="font-mono text-[11.5px] text-ink-2">{fmtDateTime(a.createdAt)} · {tr("dựa trên hồ sơ v{p0}", { p0: a.profileVersion })}</span>
              </span>
              <span className="text-[13px]">{a.reason}</span>
              {a.reviewNote && <span className="text-[12.5px] text-ink-2">{tr("Ghi chú duyệt")}: {a.reviewNote}</span>}
            </div>
            {a.status === "PENDING" && a.creatorId === myId && (
              <Button size="xs" variant="outline" onClick={() => onWithdraw(a)}>{tr("Rút")}</Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LegalDialog({ props, profile, name, orgId, invalidate }: { props: { open: boolean; onOpenChange: (o: boolean) => void }; profile: EnterpriseProfile; name: string; orgId: string; invalidate: string[][] }) {
  const addresses = useQuery({ queryKey: ["vn-addresses"], queryFn: wapi.addresses, staleTime: Infinity });
  const evidence = useQuery({ queryKey: ["ws-evidence", "PROFILE", orgId], queryFn: () => wapi.evidence({ entityType: "PROFILE", entityId: orgId }) });
  const prod = profile.legalData.production;
  return (
    <CommandDialog
      {...props}
      title={tr("Đề nghị điều chỉnh hồ sơ pháp lý")}
      endpoint="POST /enterprise-workspace/profile/amendments"
      description={tr("Bản đề nghị là ảnh chụp bất biến. Nếu hồ sơ hiệu lực đổi trước khi duyệt, nền tảng sẽ không duyệt được và bạn cần gửi lại. Bỏ năng lực đang dùng trong chuỗi, tồn kho hoặc giao nhận dở dang sẽ bị từ chối khi duyệt.")}
      schema={legalSchema}
      defaultValues={{
        name,
        legalForm: profile.legalForm as "ENTERPRISE",
        businessId: profile.legalData.businessId ?? "",
        registrationNumber: profile.legalData.registrationNumber ?? "",
        representativeTitle: profile.legalData.representativeTitle ?? "",
        address: profile.address,
        provinceCode: profile.provinceCode ?? "",
        wardCode: profile.wardCode ?? "",
        representative: profile.representative,
        activities: z.array(z.enum(["FARM", "TRANSPORTER", "DISTRIBUTOR", "RETAILER"])).parse(profile.activities),
        growingAreaCode: prod?.growingAreaCode ?? "", packingFacilityCode: prod?.packingFacilityCode ?? "", scaleEstimate: prod?.scaleEstimate ?? "", facilityCount: prod?.facilityCount ? String(prod.facilityCount) : "",
        productGroups: prod?.productGroups.join(", ") ?? "",
        certifications: prod?.certifications ?? [],
        evidenceIds: [],
        reason: "",
      }}
      version={profile.version}
      wide
      submitLabel={tr("Gửi đề nghị")}
      invalidate={invalidate}
      run={(v, cmd) => {
        const production: ProductionDetails | undefined = v.activities.includes("FARM")
          ? { sector: "CROP", productGroups: (v.productGroups ?? "").split(",").map((x) => x.trim()).filter(Boolean), certifications: certificationsForApi(v.certifications), growingAreaCode: v.growingAreaCode || undefined, packingFacilityCode: v.packingFacilityCode || undefined, scaleEstimate: v.scaleEstimate || undefined, ...(v.facilityCount ? {facilityCount: Number(v.facilityCount)} : {}) }
          : undefined;
        return wapi.submitAmendment(
          {
            profile: { name: v.name, legalForm: v.legalForm, businessId: v.businessId || undefined, address: v.address, provinceCode: v.provinceCode, wardCode: v.wardCode, representative: v.representative, activities: v.activities, registrationNumber: v.registrationNumber || undefined, representativeTitle: v.representativeTitle || undefined, production },
            evidenceIds: v.evidenceIds,
            version: profile.version,
            reason: v.reason,
          },
          cmd,
        );
      }}
    >
      {(f) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField control={f.control} name="name" label={tr("Tên tổ chức")} max={255} />
            <SelectField control={f.control} name="legalForm" label={tr("Loại hình")} options={Object.entries(LEGAL_FORM_LABEL).map(([value, label]) => ({ value, label }))} />
            <TextField control={f.control} name="businessId" label={tr("Mã số thuế / mã pháp lý")} inputMode="numeric" />
            <TextField control={f.control} name="registrationNumber" label={tr("Số giấy đăng ký")} />
            <TextField control={f.control} name="representative" label={tr("Người đại diện")} />
            <TextField control={f.control} name="representativeTitle" label={tr("Chức vụ người đại diện")} />
          </div>
          <TextField control={f.control} name="address" label={tr("Địa chỉ (số nhà, đường)")} max={500} />
          <AddressFields control={f.control as never} provinces={addresses.data ?? []} loading={addresses.isLoading} />
          <CheckGroup control={f.control as never} name="activities" label={tr("Năng lực")} options={ACTIVITIES.map((a) => ({ value: a, label: CAPABILITY_LABEL[a] ?? a }))} />
          <FarmOnly control={f.control as never}><TextField control={f.control} name="growingAreaCode" label={tr("Mã vùng trồng")}/><TextField control={f.control} name="packingFacilityCode" label={tr("Mã cơ sở đóng gói")}/><TextField control={f.control} name="scaleEstimate" label={tr("Quy mô dự kiến")}/><TextField control={f.control} name="facilityCount" label={tr("Số cơ sở")} type="number"/>
            <TextField control={f.control} name="productGroups" label={tr("Nhóm sản phẩm (cách nhau bằng dấu phẩy)")} />
            <CheckGroup control={f.control as never} name="certifications" label={tr("Chứng nhận")} options={CERTS.map((c) => ({ value: c, label: c }))} />
          </FarmOnly>
          <EvidencePick control={f.control as never} rows={evidence.data ?? []} />
          <TextAreaField control={f.control} name="reason" label={tr("Lý do điều chỉnh")} max={1000} />
        </>
      )}
    </CommandDialog>
  );
}

function AddressFields({ control, provinces, loading }: { control: Control<Record<string, string>>; provinces: AddressProvince[]; loading: boolean }) {
  const code = useWatch({ control, name: "provinceCode" });
  const wards = provinces.find((p) => p.code === code)?.wards ?? [];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SelectField control={control} name="provinceCode" label={loading ? tr("Đang tải danh mục…") : tr("Tỉnh/thành")} options={provinces.map((p) => ({ value: p.code, label: p.name }))} />
      <SelectField control={control} name="wardCode" label={tr("Phường/xã")} options={wards.map((w) => ({ value: w.code, label: w.name }))} />
    </div>
  );
}

function FarmOnly({ control, children }: { control: Control<Record<string, string[]>>; children: React.ReactNode }) {
  const acts = useWatch({ control, name: "activities" });
  if (!acts?.includes("FARM")) return null;
  return <fieldset className="flex flex-col gap-3 rounded-md border border-line px-3 py-3"><legend className="px-1 text-[12.5px] font-medium">{tr("Thông tin sản xuất (trồng trọt)")}</legend>{children}</fieldset>;
}

function CheckGroup({ control, name, label, options }: { control: Control<Record<string, string[]>>; name: string; label: string; options: { value: string; label: string }[] }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-medium">{label}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {options.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={field.value.includes(o.value)} onCheckedChange={(c) => field.onChange(c ? [...field.value, o.value] : field.value.filter((x) => x !== o.value))} />
                {o.label}
              </label>
            ))}
          </div>
          {fieldState.error && <span className="text-[12px] text-danger">{fieldState.error.message}</span>}
        </fieldset>
      )}
    />
  );
}

function EvidencePick({ control, rows }: { control: Control<Record<string, string[]>>; rows: Evidence[] }) {
  return (
    <Controller
      control={control}
      name="evidenceIds"
      render={({ field, fieldState }) => (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-medium">{tr("Chứng cứ pháp lý kèm theo (1–8)")}</legend>
          {rows.length ? (
            rows.map((e) => (
              <label key={e.id} className="flex items-start gap-2 text-[13px]">
                <Checkbox className="mt-0.5" checked={field.value.includes(e.id)} onCheckedChange={(c) => field.onChange(c ? [...field.value, e.id] : field.value.filter((x) => x !== e.id))} />
                <span className="flex flex-col">
                  <span>{e.description}</span>
                  <span className="font-mono text-[11px] text-ink-2">{e.fileName}</span>
                </span>
              </label>
            ))
          ) : (
            <span className="text-[12.5px] text-ink-2">{tr("Tải giấy tờ pháp lý ở khối Chứng cứ pháp lý trước khi gửi đề nghị.")}</span>
          )}
          {fieldState.error && <span className="text-[12px] text-danger">{fieldState.error.message}</span>}
        </fieldset>
      )}
    />
  );
}
