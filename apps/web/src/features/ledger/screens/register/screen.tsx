"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ledgerRequest } from "@/lib/ledger/request";
import { sanitizeLedgerRegistrationDraft } from "@/lib/ledger/registration";
import { useRegistrationEmail } from "@/lib/use-registration-email";
import { t } from "@/lib/ledger/i18n";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import {
  REGISTRATION_STEPS,
  REGISTRATION_ROLES,
  registrationDefaults,
  registrationRoleFields,
  legalFormsFor,
  registeredLegalForm,
  validateRegistrationStep,
  PROCESSING_TYPE_OPTIONS,
  PROCESSING_CERT_OPTIONS,
  CERTIFICATION_OPTIONS,
  type RegistrationDraft,
  type RegistrationFiles,
  type RegistrationErrors,
  type DocumentKind,
  type AddressProvince,
} from "@/lib/registration-form";
import { useLocale } from "@/components/ledger/locale";
import { LedgerPublicShell } from "@/components/ledger/shell/public-shell";
import {
  PageHeader,
  PageBody,
  Section,
  Fields,
  Field,
  Callout,
  ErrorState,
} from "@/components/ledger/kit/page";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { Label } from "@/components/ledger/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ledger/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ledger/ui/dialog";
import {
  RegistrationText,
  RegistrationSelect,
  RegistrationCheck,
  RegistrationUpload,
} from "./fields";
import { useRegistrationProtocol } from "./use-registration-protocol";
import { RegistrationReview } from "./review";
type TextKey = {
  [K in keyof RegistrationDraft]: RegistrationDraft[K] extends string
    ? K
    : never;
}[keyof RegistrationDraft];
const DRAFT_KEY = "agritrace:enterprise-registration-draft:v5";
export default function LedgerScreen(_props: LedgerScreenProps) {
  void _props;
  useLocale();
  const [draft, setDraft] = useState(() =>
      sanitizeLedgerRegistrationDraft(registrationDefaults),
    ),
    [step, setStep] = useState(0),
    [files, setFiles] = useState<RegistrationFiles>({}),
    [errors, setErrors] = useState<RegistrationErrors>({}),
    [addresses, setAddresses] = useState<AddressProvince[]>([]),
    [catalogError, setCatalogError] = useState<unknown>(null),
    [catalogLoading, setCatalogLoading] = useState(true),
    [otpOpen, setOtpOpen] = useState(false),
    [code, setCode] = useState(""),
    [saved, setSaved] = useState(false),
    [complete, setComplete] = useState<{
      email: string;
      status: string;
    } | null>(null),
    [now, setNow] = useState(Date.now);
  const loginEmail = useRegistrationEmail(draft.email, step >= 1),
    contactEmail = useRegistrationEmail(draft.contactEmail, step >= 1);
  const protocol = useRegistrationProtocol({
    draft,
    files,
    onComplete: (receipt, email) => {
      setComplete({ email, status: receipt.status });
      setOtpOpen(false);
      setFiles({});
      setCode("");
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* Optional storage. */
      }
    },
    onFileError: (kind, message) => {
      setErrors((current) => ({ ...current, [kind]: message }));
      setStep(kind === "AUTHORIZATION" ? 1 : kind === "CERTIFICATE" ? 2 : 0);
      setOtpOpen(false);
    },
  });
  const locked = protocol.pending || protocol.frozen;
  async function loadCatalog() {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      setAddresses(
        await ledgerRequest<AddressProvince[]>(
          "/reference-data/addresses",
          {},
          false,
        ),
      );
    } catch (cause) {
      setCatalogError(cause);
    } finally {
      setCatalogLoading(false);
    }
  }
  useEffect(() => {
    void loadCatalog();
    try {
      const value = localStorage.getItem(DRAFT_KEY);
      if (value) setDraft(sanitizeLedgerRegistrationDraft(JSON.parse(value)));
    } catch {
      /* Corrupt or unavailable drafts do not bypass validation. */
    }
  }, []);
  useEffect(() => {
    if (!otpOpen) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [otpOpen]);
  function update<K extends keyof RegistrationDraft>(
    key: K,
    value: RegistrationDraft[K],
  ) {
    if (locked) return;
    setSaved(false);
    setErrors((current) => ({ ...current, [key]: undefined }));
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(key === "representative" && current.sameRepresentative
        ? { fullName: String(value) }
        : {}),
      ...(key === "fullName" ? { sameRepresentative: false } : {}),
      ...(![
        "declaration",
        "termsAccepted",
        "privacyAcknowledged",
        "marketingAccepted",
      ].includes(key)
        ? {
            declaration: false,
            termsAccepted: false,
            privacyAcknowledged: false,
          }
        : {}),
    }));
  }
  const text = (
    key: TextKey,
    label: string,
    type = "text",
    wide = false,
    multiline = false,
  ) => (
    <RegistrationText
      key={key}
      name={key}
      label={t(label)}
      value={draft[key]}
      type={type}
      wide={wide}
      multiline={multiline}
      error={
        errors[key] ||
        (key === "email"
          ? loginEmail.error
          : key === "contactEmail"
            ? contactEmail.error
            : undefined)
      }
      onChange={(value) => update(key, value)}
    />
  );
  const upload = (kind: DocumentKind, label: string) => (
    <RegistrationUpload
      key={kind}
      kind={kind}
      label={t(label)}
      files={files}
      error={errors[kind]}
      onError={(message) =>
        setErrors((current) => ({ ...current, [kind]: message }))
      }
      onChange={(value) => {
        if (locked) return;
        setFiles((current) => ({ ...current, [kind]: value }));
        setErrors((current) => ({ ...current, [kind]: undefined }));
        setDraft((current) => ({
          ...current,
          declaration: false,
          termsAccepted: false,
          privacyAcknowledged: false,
        }));
      }}
    />
  );
  const choices = (
    name: "certifications" | "processingTypes" | "processingCertifications",
    options: readonly (readonly [string, string])[],
  ) =>
    options.map(([value, label]) => (
      <RegistrationCheck
        key={value}
        name={`${name}-${value}`}
        label={t(label)}
        checked={draft[name].includes(value)}
        onChange={(checked) =>
          update(
            name,
            checked
              ? [...draft[name], value]
              : draft[name].filter((v) => v !== value),
          )
        }
      />
    ));
  async function validateThrough(last: number) {
    const nextErrors: RegistrationErrors = {};
    for (let i = 0; i <= last; i++)
      Object.assign(
        nextErrors,
        validateRegistrationStep(draft, i, addresses, files),
      );
    if (last >= 1 && !nextErrors.email && !nextErrors.contactEmail) {
      const [loginOk, contactOk] = await Promise.all([
        loginEmail.check(),
        contactEmail.check(),
      ]);
      if (!loginOk)
        nextErrors.email =
          loginEmail.error || t("Chưa xác minh được email đăng nhập");
      if (!contactOk)
        nextErrors.contactEmail =
          contactEmail.error || t("Chưa xác minh được email liên hệ");
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      if (nextErrors.email || nextErrors.contactEmail) setStep(1);
      for (let i = 0; i <= last; i++)
        if (
          Object.keys(
            validateRegistrationStep(draft, i, addresses, files),
          ).some((key) => key in nextErrors)
        ) {
          setStep(i);
          break;
        }
      return false;
    }
    return true;
  }
  async function goTo(target: number) {
    if (locked) return;
    if (target <= step || (await validateThrough(target - 1))) setStep(target);
  }
  const producer = draft.activities.includes("FARM"),
    processor = draft.activities.includes("PROCESSOR"),
    registered = registeredLegalForm(draft.legalForm),
    province = addresses.find((p) => p.code === draft.provinceCode);
  const cooldown = protocol.receipt
    ? Math.max(
        0,
        Math.ceil((Date.parse(protocol.receipt.resendAfter) - now) / 1000),
      )
    : 0;
  if (complete)
    return (
      <LedgerPublicShell>
        <PageHeader title={t("Đã gửi hồ sơ xét duyệt")} />
        <PageBody>
          <Section>
            <Fields>
              <Field label={t("Email đăng nhập")}>{complete.email}</Field>
              <Field label={t("Trạng thái")}>{complete.status}</Field>
            </Fields>
            <div className="flex flex-col gap-3 px-5 pb-5">
              <Callout tone="ok">
                {t(
                  "Thông tin đăng nhập được gửi qua email sau khi hồ sơ được tiếp nhận. Hồ sơ và dịch vụ cần được xét duyệt, kích hoạt trước khi mở nghiệp vụ.",
                )}
              </Callout>
              <Button asChild variant="outline" className="self-start">
                <Link href="/login">{t("Đăng nhập")}</Link>
              </Button>
            </div>
          </Section>
        </PageBody>
      </LedgerPublicShell>
    );
  return (
    <LedgerPublicShell>
      <div data-testid="ledger-registration">
        <PageHeader
          title={t("Đăng ký doanh nghiệp")}
          description={t(
            "Cung cấp hồ sơ để AgriTrace xét duyệt tổ chức và năng lực hoạt động.",
          )}
          actions={
            <Button asChild variant="outline">
              <Link href="/login">{t("Đã có tài khoản")}</Link>
            </Button>
          }
        />
        <PageBody wide>
          {catalogError ? (
            <ErrorState
              error={catalogError}
              onRetry={() => void loadCatalog()}
            />
          ) : (
            <>
              <Tabs
                value={String(step)}
                onValueChange={(value) => void goTo(Number(value))}
              >
                <TabsList className="flex h-auto w-full min-w-0 flex-nowrap justify-start gap-1 overflow-x-auto overscroll-x-contain bg-transparent p-0 md:w-auto md:flex-wrap md:overflow-visible">
                  {REGISTRATION_STEPS.map((label, index) => (
                    <TabsTrigger
                      key={label}
                      value={String(index)}
                      disabled={locked}
                      className="h-auto flex-none snap-start whitespace-nowrap px-3 py-2 text-left md:flex-1 md:whitespace-normal"
                    >
                      <span className="font-mono">{index + 1}.</span>
                      {t(label)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Section title={t(REGISTRATION_STEPS[step])} className="min-w-0">
                <form
                  noValidate
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (protocol.pending) return;
                    if (protocol.frozen) {
                      setOtpOpen(true);
                      await protocol.retry(code);
                      return;
                    }
                    if (!(await validateThrough(4))) return;
                    setOtpOpen(true);
                    setCode("");
                    await protocol.send();
                  }}
                >
                  <fieldset
                    disabled={locked || catalogLoading}
                    className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 px-4 py-5 sm:grid-cols-2 sm:px-5"
                  >
                    {step === 0 && (
                      <>
                        <RegistrationSelect
                          name="registrationRole"
                          label={t("Vai trò đăng ký")}
                          value={draft.registrationRole}
                          options={REGISTRATION_ROLES.map(([value, label]) => [
                            value,
                            label,
                          ])}
                          error={errors.registrationRole}
                          onChange={(value) => {
                            update("registrationRole", value);
                            setDraft((current) => ({
                              ...current,
                              ...registrationRoleFields(value),
                              legalForm: legalFormsFor(value).some(
                                ([code]) => code === current.legalForm,
                              )
                                ? current.legalForm
                                : "ENTERPRISE",
                            }));
                          }}
                        />
                        {text("organizationName", "Tên tổ chức / chủ thể")}
                        <RegistrationSelect
                          name="legalForm"
                          label={t("Loại chủ thể")}
                          value={draft.legalForm}
                          options={legalFormsFor(draft.registrationRole)}
                          error={errors.legalForm}
                          onChange={(value) => update("legalForm", value)}
                        />
                        {registered && (
                          <>
                            {text("businessId", "Mã số thuế")}
                            {text("registrationNumber", "Số giấy đăng ký")}
                            {upload(
                              "LEGAL_REGISTRATION",
                              "Giấy đăng ký tổ chức",
                            )}
                          </>
                        )}
                        {text("establishedDate", "Ngày thành lập", "date")}
                        <RegistrationSelect
                          name="provinceCode"
                          label={t("Tỉnh / thành phố")}
                          value={draft.provinceCode}
                          options={addresses.map((p) => [p.code, p.name])}
                          error={errors.provinceCode}
                          onChange={(value) => {
                            const selected = addresses.find(
                              (p) => p.code === value,
                            );
                            update("provinceCode", value);
                            setDraft((current) => ({
                              ...current,
                              province: selected?.name ?? "",
                              wardCode: "",
                              ward: "",
                            }));
                          }}
                        />
                        <RegistrationSelect
                          name="wardCode"
                          label={t("Xã / phường")}
                          value={draft.wardCode}
                          options={(province?.wards ?? []).map((w) => [
                            w.code,
                            w.name,
                          ])}
                          error={errors.wardCode}
                          onChange={(value) => {
                            update("wardCode", value);
                            setDraft((current) => ({
                              ...current,
                              ward:
                                province?.wards.find((w) => w.code === value)
                                  ?.name ?? "",
                            }));
                          }}
                        />
                        {text("address", "Địa chỉ chi tiết", "text", true)}
                        {text("website", "Website", "url")}
                        {upload("LOGO", "Logo tổ chức")}
                      </>
                    )}
                    {step === 1 && (
                      <>
                        {text("representative", "Người đại diện / chủ hồ sơ")}
                        {registered &&
                          text("representativeTitle", "Chức vụ người đại diện")}
                        {text("phone", "Số điện thoại", "tel")}
                        {text("contactEmail", "Email liên hệ", "email")}
                        <RegistrationSelect
                          name="registrantRelationship"
                          label={t("Người thực hiện đăng ký")}
                          value={draft.registrantRelationship}
                          options={[
                            ["REPRESENTATIVE", "Người đại diện / chủ hồ sơ"],
                            ["AUTHORIZED", "Người được ủy quyền"],
                          ]}
                          error={errors.registrantRelationship}
                          onChange={(value) =>
                            update("registrantRelationship", value)
                          }
                        />
                        {draft.registrantRelationship === "AUTHORIZED" &&
                          upload("AUTHORIZATION", "Giấy ủy quyền")}
                        <RegistrationCheck
                          name="sameRepresentative"
                          label={t("Quản trị viên cũng là người đại diện")}
                          checked={draft.sameRepresentative}
                          onChange={(checked) => {
                            update("sameRepresentative", checked);
                            if (checked)
                              setDraft((current) => ({
                                ...current,
                                fullName: current.representative,
                              }));
                          }}
                        />
                        {text("fullName", "Họ tên quản trị viên")}
                        {text("email", "Email đăng nhập", "email")}
                        <div className="sm:col-span-2">
                          <Callout tone="info">
                            {t(
                              "Không đặt mật khẩu trong hồ sơ. Mật khẩu tạm được gửi tới email đăng nhập sau khi hồ sơ được tiếp nhận và phải đổi ở lần đăng nhập đầu.",
                            )}
                          </Callout>
                        </div>
                      </>
                    )}
                    {step === 2 && (
                      <>
                        <div className="sm:col-span-2">
                          <Callout>
                            {t("Năng lực yêu cầu")}:{" "}
                            {draft.activities.join(", ")}
                          </Callout>
                        </div>
                        {producer && (
                          <>
                            {text(
                              "productGroups",
                              "Nhóm sản phẩm",
                              "text",
                              true,
                            )}
                            {text("growingAreaCode", "Mã vùng trồng")}
                            {text("packingFacilityCode", "Mã cơ sở đóng gói")}
                            {text("scaleEstimate", "Quy mô dự kiến")}
                            {text(
                              "facilityCount",
                              "Số cơ sở dự kiến",
                              "number",
                            )}
                            <fieldset className="flex flex-col gap-2">
                              <legend className="mb-2 text-[13px] font-medium">
                                {t("Chứng nhận sản xuất")}
                              </legend>
                              {choices("certifications", CERTIFICATION_OPTIONS)}
                            </fieldset>
                          </>
                        )}
                        {processor && (
                          <>
                            <fieldset className="flex flex-col gap-2">
                              <legend className="mb-2 text-[13px] font-medium">
                                {t("Loại hình chế biến")}
                              </legend>
                              {choices(
                                "processingTypes",
                                PROCESSING_TYPE_OPTIONS,
                              )}
                              <span className="text-[12px] text-danger">
                                {errors.processingTypes}
                              </span>
                            </fieldset>
                            {text(
                              "foodSafetyCertificateNumber",
                              "Số giấy chứng nhận an toàn thực phẩm",
                            )}
                            {text(
                              "foodSafetyCertificateExpiry",
                              "Hạn giấy chứng nhận",
                              "date",
                            )}
                            {text(
                              "processingFacilityCode",
                              "Mã cơ sở chế biến",
                            )}
                            {text(
                              "dailyCapacityKg",
                              "Công suất (kg/ngày)",
                              "number",
                            )}
                            <fieldset className="flex flex-col gap-2">
                              <legend className="mb-2 text-[13px] font-medium">
                                {t("Chứng nhận chế biến")}
                              </legend>
                              {choices(
                                "processingCertifications",
                                PROCESSING_CERT_OPTIONS,
                              )}
                            </fieldset>
                          </>
                        )}
                        {(processor ||
                          (producer && draft.certifications.length > 0)) &&
                          upload(
                            "CERTIFICATE",
                            processor
                              ? "Giấy chứng nhận an toàn thực phẩm"
                              : "Tài liệu chứng nhận",
                          )}
                        {!producer && !processor && (
                          <div className="sm:col-span-2">
                            <Callout>
                              {t(
                                "Thông tin cơ sở, phương tiện và quan hệ trong chuỗi được cấu hình trong không gian doanh nghiệp sau khi hồ sơ được duyệt.",
                              )}
                            </Callout>
                          </div>
                        )}
                      </>
                    )}
                    {step === 3 && (
                      <>
                        <div className="flex flex-col gap-3">
                          <RegistrationCheck
                            name="traceability"
                            label={t("Truy xuất nguồn gốc")}
                            checked
                            disabled
                            onChange={() => {}}
                          />
                          <RegistrationCheck
                            name="qr-labels"
                            label={t("Tem QR theo lô")}
                            checked={draft.interests.includes("QR_LABELS")}
                            onChange={(checked) =>
                              update(
                                "interests",
                                checked
                                  ? ["TRACEABILITY", "QR_LABELS"]
                                  : ["TRACEABILITY"],
                              )
                            }
                          />
                        </div>
                        <RegistrationSelect
                          name="hostingMode"
                          label={t("Mô hình peer quan tâm")}
                          value={draft.hostingMode}
                          options={[
                            ["MANAGED_ORG", "AgriTrace quản lý peer"],
                            ["SELF_MANAGED_ORG", "Tự vận hành peer trên VPS"],
                          ]}
                          onChange={(value) => update("hostingMode", value)}
                        />
                        <RegistrationSelect
                          name="planCode"
                          label={t("Gói quan tâm")}
                          value={draft.planCode || "UNDECIDED"}
                          options={[
                            ["UNDECIDED", "Chưa quyết định"],
                            ["TRACE_5", "Trace 5"],
                            ["TRACE_10", "Trace 10"],
                            ["TRACE_20", "Trace 20"],
                            ["CHAIN_PRO", "Chain Pro"],
                          ]}
                          onChange={(value) =>
                            update(
                              "planCode",
                              value === "UNDECIDED" ? "" : value,
                            )
                          }
                        />
                        <RegistrationSelect
                          name="expectedProducts"
                          label={t("Số sản phẩm dự kiến")}
                          value={draft.expectedProducts}
                          options={[
                            ["UNDECIDED", "Chưa quyết định"],
                            ["UP_TO_10", "Tối đa 10"],
                            ["UP_TO_100", "Tối đa 100"],
                            ["OVER_100", "Trên 100"],
                          ]}
                          onChange={(value) =>
                            update("expectedProducts", value)
                          }
                        />
                        {text(
                          "expectedLotsPerMonth",
                          "Số lô dự kiến mỗi tháng",
                          "number",
                        )}
                        <RegistrationSelect
                          name="partnerIntent"
                          label={t("Nhu cầu tìm đối tác")}
                          value={draft.partnerIntent}
                          options={[
                            ["LATER", "Để sau"],
                            ["YES", "Có nhu cầu"],
                          ]}
                          onChange={(value) => update("partnerIntent", value)}
                        />
                        {text(
                          "integrationNotes",
                          "Nhu cầu hỗ trợ tích hợp",
                          "text",
                          true,
                          true,
                        )}
                        {text(
                          "description",
                          "Giới thiệu tổ chức",
                          "text",
                          true,
                          true,
                        )}
                        <div className="sm:col-span-2">
                          <Callout tone="info">
                            {t(
                              "Đây là nguyện vọng dịch vụ; chưa tạo hợp đồng, thanh toán hoặc cấp quyền nghiệp vụ.",
                            )}
                          </Callout>
                        </div>
                      </>
                    )}
                    {step === 4 && (
                      <>
                        <div className="sm:col-span-2">
                          <RegistrationReview draft={draft} files={files} />
                        </div>
                        <div className="flex flex-col gap-3 sm:col-span-2">
                          <RegistrationCheck
                            name="declaration"
                            label={t("Xác nhận thông tin chính xác")}
                            checked={draft.declaration}
                            onChange={(checked) =>
                              update("declaration", checked)
                            }
                            error={errors.declaration}
                          />
                          <RegistrationCheck
                            name="termsAccepted"
                            label={t("Đồng ý điều khoản sử dụng")}
                            checked={draft.termsAccepted}
                            onChange={(checked) =>
                              update("termsAccepted", checked)
                            }
                            error={errors.termsAccepted}
                          />
                          <Link
                            href="/terms"
                            target="_blank"
                            rel="noreferrer"
                            className="text-[12px] text-brand underline"
                          >
                            {t("Xem điều khoản")}
                          </Link>
                          <RegistrationCheck
                            name="privacyAcknowledged"
                            label={t("Đã đọc chính sách quyền riêng tư")}
                            checked={draft.privacyAcknowledged}
                            onChange={(checked) =>
                              update("privacyAcknowledged", checked)
                            }
                            error={errors.privacyAcknowledged}
                          />
                          <Link
                            href="/privacy"
                            target="_blank"
                            rel="noreferrer"
                            className="text-[12px] text-brand underline"
                          >
                            {t("Xem chính sách quyền riêng tư")}
                          </Link>
                          <RegistrationCheck
                            name="marketingAccepted"
                            label={t(
                              "Đồng ý nhận thông tin tiếp thị (không bắt buộc)",
                            )}
                            checked={draft.marketingAccepted}
                            onChange={(checked) =>
                              update("marketingAccepted", checked)
                            }
                          />
                        </div>
                      </>
                    )}
                  </fieldset>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={locked || step === 0}
                        onClick={() => void goTo(step - 1)}
                      >
                        {t("Quay lại")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={locked}
                        onClick={() => {
                          try {
                            localStorage.setItem(
                              DRAFT_KEY,
                              JSON.stringify(
                                sanitizeLedgerRegistrationDraft(draft),
                              ),
                            );
                            setSaved(true);
                          } catch {
                            setSaved(false);
                          }
                        }}
                      >
                        {t("Lưu bản nháp")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={locked}
                        onClick={() => {
                          try {
                            localStorage.removeItem(DRAFT_KEY);
                            setSaved(false);
                          } catch {
                            /* Optional storage. */
                          }
                        }}
                      >
                        {t("Xóa bản nháp")}
                      </Button>
                      {saved && (
                        <span
                          role="status"
                          className="self-center text-[12px] text-ok"
                        >
                          {t("Đã lưu bản nháp trên thiết bị này")}
                        </span>
                      )}
                    </div>
                    {step < 4 ? (
                      <Button
                        type="button"
                        disabled={locked || catalogLoading}
                        onClick={() => void goTo(step + 1)}
                      >
                        {t("Tiếp tục")}
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        disabled={protocol.pending || catalogLoading}
                      >
                        {protocol.frozen
                          ? t("Đối soát")
                          : t("Gửi hồ sơ xét duyệt")}
                      </Button>
                    )}
                  </div>
                </form>
              </Section>
              {protocol.error && !otpOpen && (
                <div role="alert">
                  <Callout tone="danger">{protocol.error}</Callout>
                </div>
              )}
            </>
          )}
        </PageBody>
        <Dialog
          open={otpOpen}
          onOpenChange={(open) => {
            if (!protocol.pending && !protocol.frozen) setOtpOpen(open);
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("Xác thực email đăng nhập")}</DialogTitle>
              <DialogDescription>
                {t("Mã xác thực được gửi tới")} {draft.email}.{" "}
                {t("Hồ sơ chỉ được gửi sau khi xác thực thành công.")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <Label htmlFor="registration-otp">{t("Mã OTP")}</Label>
              <Input
                id="registration-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                disabled={protocol.pending || protocol.frozen}
                onChange={(event) => setCode(event.target.value)}
                className="font-mono text-[18px] tracking-[0.25em]"
              />
              {protocol.error && (
                <div role="alert">
                  <Callout tone="danger">{protocol.error}</Callout>
                </div>
              )}
              {protocol.phase && (
                <span role="status" className="text-[12px] text-ink-2">
                  {protocol.phase}
                </span>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={locked}
                onClick={() => setOtpOpen(false)}
              >
                {t("Đóng")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={locked || cooldown > 0}
                onClick={() => void protocol.send()}
              >
                {cooldown
                  ? `${t("Gửi lại mã")} (${cooldown}s)`
                  : t("Gửi lại mã")}
              </Button>
              <Button
                type="button"
                disabled={
                  protocol.pending ||
                  (!protocol.frozen && !/^\d{6}$/.test(code))
                }
                onClick={() => void protocol.retry(code)}
              >
                {protocol.frozen ? t("Đối soát") : t("Xác thực và gửi hồ sơ")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </LedgerPublicShell>
  );
}
