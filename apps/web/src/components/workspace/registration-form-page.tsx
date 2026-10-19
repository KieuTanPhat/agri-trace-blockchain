"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Building2,
  Sprout,
  Truck,
  Warehouse,
  Store,
  UploadCloud,
  FileCheck2,
  X,
  Save,
  ShieldCheck,
} from "lucide-react";
import { request } from "@/lib/api-client";
import {
  onboardingError,
  registerEnterprise,
  type Registration,
} from "@/lib/enterprise-onboarding";
import { RegistrationEmailOtp } from "./registration-email-otp";
import { RegistrationReview } from "./registration-review";
import { useRegistrationEmail } from "@/lib/use-registration-email";
import type { components } from "@/lib/generated/api";
import type { AddressProvince } from "@/lib/registration-form";
import {
  ACTIVITY_OPTIONS,
  CERTIFICATION_OPTIONS,
  INTEREST_OPTIONS,
  LEGAL_FORM_OPTIONS,
  REGISTRATION_STEPS,
  registeredLegalForm,
  registrationDefaults,
  validateRegistrationStep,
  type DocumentKind,
  type RegistrationDraft,
  type RegistrationFiles,
  type RegistrationErrors,
  type RegistrationField,
} from "@/lib/registration-form";
import "@/styles/registration.css";

type S = components["schemas"];
const DRAFT_KEY = "agritrace:enterprise-registration-draft:v4";
const subtitles = [
  "Cho chúng tôi biết về tổ chức hoặc cơ sở sản xuất của bạn.",
  "Thông tin liên hệ và người quản lý tài khoản doanh nghiệp.",
  "Chọn các hoạt động mà tổ chức của bạn đang thực hiện.",
  "Chọn dịch vụ phù hợp với cách bạn muốn sử dụng AgriTrace.",
  "Rà soát thông tin và xác thực email trước khi gửi xét duyệt.",
];
const icons = {
  FARM: Sprout,
  TRANSPORTER: Truck,
  DISTRIBUTOR: Warehouse,
  RETAILER: Store,
};
const fileLabels: Record<DocumentKind, string> = {
  LOGO: "Logo tổ chức",
  LEGAL_REGISTRATION: "Giấy đăng ký của tổ chức",
  AUTHORIZATION: "Giấy ủy quyền",
  CERTIFICATE: "Tài liệu chứng nhận",
};
export function RegistrationFormPage() {
  const [draft, setDraft] = useState<RegistrationDraft>(registrationDefaults);
  const [step, setStep] = useState(0),
    [reached, setReached] = useState(0),
    [pending, setPending] = useState(false),
    [frozen, setFrozen] = useState(false),
    [complete, setComplete] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [uploadStatus, setUploadStatus] = useState("");
  const [files, setFiles] = useState<RegistrationFiles>({});
  const [fieldErrors, setFieldErrors] = useState<RegistrationErrors>({});
  const accountEmail = useRegistrationEmail(
    draft.email,
    step === 1 && !pending && !frozen,
  );
  const [addresses, setAddresses] = useState<AddressProvince[]>([]),
    [addressError, setAddressError] = useState("");
  const [proofs, setProofs] = useState<
    Record<string, S["RegistrationOtpVerifiedView"]>
  >({});
  const registrationId = useRef("");
  if (!registrationId.current) registrationId.current = crypto.randomUUID();
  const original = useRef<Registration | null>(null),
    busy = useRef(false),
    uploaded = useRef(new Map<string, S["RegistrationDocumentViewDto"]>());
  const titleRef = useRef<HTMLHeadingElement>(null);
  const registered = registeredLegalForm(draft.legalForm),
    producer = draft.activities.includes("FARM");
  const emails = [
    ...new Set(
      [draft.email, draft.contactEmail].map((e) => e.trim().toLowerCase()),
    ),
  ];
  useEffect(() => {
    let active = true;
    request<AddressProvince[]>("/reference-data/addresses", undefined, false)
      .then((data) => {
        if (active) setAddresses(data);
      })
      .catch(() => {
        if (active)
          setAddressError(
            "Chưa tải được danh mục địa chỉ. Tải lại trang để tiếp tục; bạn có thể lưu bản nháp trước.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(DRAFT_KEY) ?? "null",
      ) as Record<string, unknown> | null;
      if (saved) {
        const restored = { ...registrationDefaults };
        for (const key of Object.keys(
          restored,
        ) as (keyof RegistrationDraft)[]) {
          if (
            [
              "password",
              "passwordConfirm",
              "declaration",
              "termsAccepted",
              "privacyAcknowledged",
              "marketingAccepted",
            ].includes(key)
          )
            continue;
          const value = saved[key];
          if (
            typeof value === typeof restored[key] &&
            (!Array.isArray(value) || value.every((v) => typeof v === "string"))
          )
            (restored as Record<string, unknown>)[key] = value;
        }
        restored.interests = [
          "TRACEABILITY",
          ...(restored.interests.includes("QR_LABELS") ? ["QR_LABELS"] : []),
        ];
        setDraft(restored);
        setNotice(
          "Đã khôi phục bản nháp. Nhập lại mật khẩu, chọn lại tài liệu và xác thực email khi gửi hồ sơ.",
        );
      }
    } catch {
      /* Saving a draft is optional. */
    }
  }, []);
  function update(
    name: keyof RegistrationDraft,
    value: string | boolean | string[],
  ) {
    setFieldErrors((current) => ({ ...current, [name]: undefined }));
    setDraft((current) => {
      const next = { ...current, [name]: value };
      if (
        next.sameRepresentative &&
        (name === "representative" ||
          name === "contactEmail" ||
          name === "sameRepresentative")
      ) {
        next.fullName = next.representative;
        next.email = next.contactEmail;
      }
      return next;
    });
  }
  function move(next: number) {
    setStep(next);
    setError("");
    requestAnimationFrame(() => titleRef.current?.focus());
  }
  function fieldMessage(name: RegistrationField) {
    return fieldErrors[name] || (name === "email" ? accountEmail.error : "");
  }
  function fieldAttributes(name: RegistrationField) {
    return {
      "aria-invalid": fieldMessage(name) ? true : undefined,
      "aria-describedby": fieldMessage(name) ? `reg-${name}-error` : undefined,
    } as const;
  }
  function fieldError(name: RegistrationField) {
    const message = fieldMessage(name);
    return message ? (
      <span className="reg-field-error" id={`reg-${name}-error`} role="alert">
        {message}
      </span>
    ) : null;
  }
  function validateField(name: RegistrationField) {
    const errors = validateRegistrationStep(draft, step, addresses, files);
    setFieldErrors((current) => ({ ...current, [name]: errors[name] }));
  }
  async function validateThrough(last: number) {
    const errors: RegistrationErrors = {};
    let firstInvalid = -1;
    for (let candidate = 0; candidate <= last; candidate++) {
      const current = validateRegistrationStep(
        draft,
        candidate,
        addresses,
        files,
      );
      Object.assign(errors, current);
      if (firstInvalid < 0 && Object.values(current).some(Boolean))
        firstInvalid = candidate;
    }
    setFieldErrors(errors);
    if (firstInvalid >= 0) {
      if (firstInvalid !== step) setStep(firstInvalid);
      return false;
    }
    if (last >= 1) {
      busy.current = true;
      setPending(true);
      try {
        if (!(await accountEmail.check())) {
          if (step !== 1) setStep(1);
          return false;
        }
      } finally {
        busy.current = false;
        setPending(false);
      }
    }
    return true;
  }
  async function goTo(next: number) {
    if (busy.current || pending || frozen) return;
    if (next > step && !(await validateThrough(next - 1))) return;
    move(next);
  }
  function saveDraft() {
    try {
      const safe = {
        ...draft,
        password: undefined,
        passwordConfirm: undefined,
        declaration: undefined,
        termsAccepted: undefined,
        privacyAcknowledged: undefined,
        marketingAccepted: undefined,
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(safe));
      setNotice(
        "Đã lưu bản nháp trên thiết bị này. Mật khẩu, OTP và tài liệu không được lưu vào bản nháp.",
      );
    } catch {
      setError("Thiết bị không cho phép lưu bản nháp.");
    }
  }
  function text(
    name: keyof RegistrationDraft,
    label: string,
    {
      type = "text",
      required = false,
      full = false,
      max = 255,
      placeholder = "",
      min,
    }: {
      type?: string;
      required?: boolean;
      full?: boolean;
      max?: number;
      placeholder?: string;
      min?: number;
    } = {},
  ) {
    return (
      <label
        className={`reg-field${full ? " reg-full" : ""}`}
        htmlFor={`reg-${name}`}
      >
        <span id={`reg-${name}-label`}>
          {label}
          {required && <b aria-hidden="true"> *</b>}
        </span>
        <input
          id={`reg-${name}`}
          aria-labelledby={`reg-${name}-label`}
          name={name}
          className="input"
          type={type}
          required={required}
          maxLength={max}
          min={min}
          value={String(draft[name])}
          placeholder={placeholder}
          autoComplete={
            type === "password"
              ? "new-password"
              : name === "email"
                ? "email"
                : name === "phone"
                  ? "tel"
                  : undefined
          }
          onChange={(event) => update(name, event.target.value)}
          onBlur={() => validateField(name)}
          {...fieldAttributes(name)}
        />
        {fieldError(name)}
        {name === "email" && accountEmail.checking && (
          <small className="reg-field-status" role="status">
            Đang kiểm tra email…
          </small>
        )}
      </label>
    );
  }
  function select(
    name: keyof RegistrationDraft,
    label: string,
    options: readonly (readonly [string, string])[],
    required = false,
    full = false,
  ) {
    return (
      <label
        className={`reg-field${full ? " reg-full" : ""}`}
        htmlFor={`reg-${name}`}
      >
        <span id={`reg-${name}-label`}>
          {label}
          {required && <b aria-hidden="true"> *</b>}
        </span>
        <select
          id={`reg-${name}`}
          aria-labelledby={`reg-${name}-label`}
          name={name}
          className="input"
          required={required}
          value={String(draft[name])}
          onChange={(e) => update(name, e.target.value)}
          onBlur={() => validateField(name)}
          {...fieldAttributes(name)}
        >
          {options.map(([value, title]) => (
            <option key={value} value={value}>
              {title}
            </option>
          ))}
        </select>
        {fieldError(name)}
      </label>
    );
  }
  function upload(kind: DocumentKind, required = false) {
    const selected = files[kind];
    return (
      <div className="reg-field reg-full">
        <span>
          {fileLabels[kind]}
          {required && <b aria-hidden="true"> *</b>}{" "}
          {!required && <small>— tùy chọn</small>}
        </span>
        <div className={`reg-upload${selected ? " has-file" : ""}`}>
          {selected ? (
            <>
              <FileCheck2 size={24} />
              <div>
                <strong>{selected.file.name}</strong>
                <small>
                  {(selected.file.size / 1024).toFixed(0)} KB · Chỉ dùng để xét
                  duyệt hồ sơ
                </small>
              </div>
              <button
                className="reg-icon-button"
                type="button"
                aria-label={`Bỏ ${fileLabels[kind].toLowerCase()}`}
                onClick={() =>
                  setFiles((current) => ({ ...current, [kind]: undefined }))
                }
              >
                <X size={18} />
              </button>
            </>
          ) : (
            <>
              <UploadCloud size={25} />
              <div>
                <strong>Chọn {fileLabels[kind].toLowerCase()}</strong>
                <small>
                  {kind === "LOGO"
                    ? "JPG, PNG, WebP · tối đa 2 MB"
                    : "PDF, JPG, PNG · tối đa 5 MB; ghép nhiều trang thành một PDF"}
                </small>
              </div>
            </>
          )}
          <label className="reg-upload-pick">
            <span>{selected ? "Đổi file" : "Chọn file"}</span>
            <input
              aria-label={`Tải ${fileLabels[kind].toLowerCase()}`}
              type="file"
              {...fieldAttributes(kind)}
              accept={
                kind === "LOGO"
                  ? ".jpg,.jpeg,.png,.webp"
                  : ".pdf,.jpg,.jpeg,.png"
              }
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const limit = kind === "LOGO" ? 2097152 : 5242880;
                if (file.size < 1 || file.size > limit) {
                  setFieldErrors((current) => ({
                    ...current,
                    [kind]: `${fileLabels[kind]} vượt dung lượng cho phép hoặc là file rỗng.`,
                  }));
                  e.target.value = "";
                  return;
                }
                const extensions =
                  kind === "LOGO"
                    ? ["jpg", "jpeg", "png", "webp"]
                    : ["pdf", "jpg", "jpeg", "png"];
                if (
                  !extensions.includes(
                    file.name.split(".").pop()?.toLowerCase() ?? "",
                  )
                ) {
                  setFieldErrors((current) => ({
                    ...current,
                    [kind]: "Chọn file đúng định dạng được hỗ trợ.",
                  }));
                  e.target.value = "";
                  return;
                }
                setFiles((current) => ({
                  ...current,
                  [kind]: { id: crypto.randomUUID(), file },
                }));
                setFieldErrors((current) => ({
                  ...current,
                  [kind]: undefined,
                }));
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {fieldError(kind)}
      </div>
    );
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setError("");
    setNotice("");
    if (!frozen && !(await validateThrough(step))) return;
    if (step < 4) {
      setReached((r) => Math.max(r, step + 1));
      move(step + 1);
      return;
    }
    if (
      !original.current &&
      emails.some(
        (email) =>
          !proofs[email] || Date.parse(proofs[email].expiresAt) <= Date.now(),
      )
    ) {
      setFieldErrors((current) => ({
        ...current,
        emailVerification: "Xác thực tài khoản trước khi gửi hồ sơ.",
      }));
      return;
    }
    busy.current = true;
    setPending(true);
    let activeUpload: DocumentKind | null = null;
    try {
      if (!original.current) {
        const documentIds: string[] = [];
        const ownerProof = proofs[draft.email.trim().toLowerCase()];
        for (const [kind, selected] of Object.entries(files) as [
          DocumentKind,
          RegistrationFiles[DocumentKind],
        ][]) {
          if (
            !selected ||
            (kind === "CERTIFICATE" && !producer) ||
            (kind === "AUTHORIZATION" &&
              draft.registrantRelationship !== "AUTHORIZED")
          )
            continue;
          if (!uploaded.current.has(selected.id)) {
            activeUpload = kind;
            setUploadStatus(`Đang tải ${fileLabels[kind].toLowerCase()}…`);
            const body = new FormData();
            body.set("id", selected.id);
            body.set("registrationId", registrationId.current);
            body.set("verificationId", ownerProof.verificationId);
            body.set("token", ownerProof.token);
            body.set("kind", kind);
            body.set("file", selected.file);
            uploaded.current.set(
              selected.id,
              await request<S["RegistrationDocumentViewDto"]>(
                "/auth/registration-documents",
                { method: "POST", body },
                false,
              ),
            );
            activeUpload = null;
          }
          documentIds.push(selected.id);
        }
        original.current = {
          requestId: registrationId.current,
          email: draft.email.trim(),
          password: draft.password,
          fullName: draft.fullName.trim(),
          organizationName: draft.organizationName.trim(),
          businessId: draft.businessId.trim() || undefined,
          organizationType:
            draft.organizationType as Registration["organizationType"],
          hostingMode: draft.hostingMode as Registration["hostingMode"],
          emailVerifications: emails.map((email) => ({
            verificationId: proofs[email].verificationId,
            token: proofs[email].token,
          })),
          details: {
            formVersion: 2,
            legalForm:
              draft.legalForm as S["EnterpriseRegistrationDetails"]["legalForm"],
            address: draft.address.trim(),
            province: draft.province,
            provinceCode: draft.provinceCode,
            ward: draft.ward,
            wardCode: draft.wardCode,
            phone: draft.phone,
            contactEmail: draft.contactEmail.trim(),
            representative: draft.representative.trim(),
            representativeTitle: draft.representativeTitle.trim() || undefined,
            registrationNumber: draft.registrationNumber.trim() || undefined,
            establishedDate: draft.establishedDate || undefined,
            registrantRelationship: draft.registrantRelationship as
              "REPRESENTATIVE" | "AUTHORIZED",
            activities:
              draft.activities as S["EnterpriseRegistrationDetails"]["activities"],
            website: draft.website.trim() || undefined,
            description: draft.description.trim() || undefined,
            production: producer
              ? {
                  sector: "CROP",
                  productGroups: [
                    ...new Set(
                      draft.productGroups
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ),
                  ],
                  growingAreaCode: draft.growingAreaCode.trim() || undefined,
                  packingFacilityCode:
                    draft.packingFacilityCode.trim() || undefined,
                  scaleEstimate: draft.scaleEstimate.trim() || undefined,
                  facilityCount: draft.facilityCount
                    ? Number(draft.facilityCount)
                    : undefined,
                  certifications:
                    draft.certifications as S["RegistrationProductionDetails"]["certifications"],
                }
              : undefined,
            services: {
              interests:
                draft.interests as S["RegistrationServicePreferences"]["interests"],
              planCode: (draft.planCode ||
                undefined) as S["RegistrationServicePreferences"]["planCode"],
              expectedProducts:
                draft.expectedProducts as S["RegistrationServicePreferences"]["expectedProducts"],
              expectedLotsPerMonth: draft.expectedLotsPerMonth
                ? Number(draft.expectedLotsPerMonth)
                : undefined,
              partnerIntent: draft.partnerIntent as "YES" | "LATER",
              integrationNotes: draft.integrationNotes.trim() || undefined,
            },
            documentIds,
            declarationAccepted: true,
            termsAccepted: true,
            privacyAcknowledged: true,
            marketingAccepted: draft.marketingAccepted,
          },
        };
      }
      setUploadStatus("Đang gửi hồ sơ…");
      await registerEnterprise(original.current);
      original.current = null;
      uploaded.current.clear();
      setDraft(registrationDefaults);
      setFiles({});
      setProofs({});
      setFieldErrors({});
      setComplete(true);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* Optional storage. */
      }
    } catch (cause) {
      if (activeUpload) {
        setFieldErrors((current) => ({
          ...current,
          [activeUpload!]: onboardingError(cause),
        }));
        setStep(
          activeUpload === "AUTHORIZATION"
            ? 1
            : activeUpload === "CERTIFICATE"
              ? 2
              : 0,
        );
      } else setError(onboardingError(cause));
      if (original.current) {
        const status = (cause as { status?: number }).status;
        if (!status || status >= 500 || status === 408) setFrozen(true);
        else {
          original.current = null;
          setFrozen(false);
        }
      }
    } finally {
      busy.current = false;
      setPending(false);
      setUploadStatus("");
    }
  }
  if (complete)
    return (
      <div className="reg-shell">
        <section className="reg-complete">
          <CheckCircle2 size={54} />
          <p className="eyebrow">HỒ SƠ ĐÃ ĐƯỢC TIẾP NHẬN</p>
          <h1>Cảm ơn bạn đã đăng ký AgriTrace</h1>
          <p>
            Hồ sơ đang chờ xét duyệt. Bạn có thể đăng nhập để theo dõi trạng
            thái và nhận phản hồi qua email liên hệ.
          </p>
          <Link className="button" href="/login">
            Đăng nhập theo dõi hồ sơ <ArrowRight size={18} />
          </Link>
          <Link href="/">Về trang chủ</Link>
        </section>
      </div>
    );
  return (
    <div className="reg-shell">
      <div className="reg-topline">
        <span>
          Đã có tài khoản? <Link href="/login">Đăng nhập</Link>
        </span>
      </div>
      <nav className="reg-progress" aria-label="Các bước đăng ký">
        <ol>
          {REGISTRATION_STEPS.map((label, index) => (
            <li
              key={label}
              className={`${index === step ? "is-current" : ""} ${index < step ? "is-complete" : ""}`}
            >
              <button
                type="button"
                aria-current={index === step ? "step" : undefined}
                disabled={pending || frozen || index > reached}
                onClick={() => void goTo(index)}
              >
                <span className="reg-step-number">
                  {index < step ? <Check size={17} /> : index + 1}
                </span>
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <form className="reg-card" onSubmit={submit} noValidate>
        <header className="reg-heading">
          <span className="reg-step-caption">BƯỚC {step + 1} / 5</span>
          <h1 tabIndex={-1} ref={titleRef}>
            {REGISTRATION_STEPS[step]}
          </h1>
          <p>{subtitles[step]}</p>
          <small>
            <b>*</b> Thông tin cần cung cấp
          </small>
        </header>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <fieldset className="reg-fields" disabled={pending || frozen}>
          {step === 0 && (
            <>
              {text(
                "organizationName",
                "Tên doanh nghiệp / HTX / chủ thể sản xuất",
                {
                  required: true,
                  full: true,
                  placeholder: "Nhập tên theo hồ sơ của bạn",
                },
              )}
              {select(
                "legalForm",
                "Loại hình chủ thể",
                LEGAL_FORM_OPTIONS,
                true,
              )}
              {text("businessId", "Mã số thuế / định danh pháp lý", {
                required: registered,
                max: 14,
                placeholder: registered ? "Mã số theo hồ sơ đăng ký" : "Nếu có",
              })}
              {text("registrationNumber", "Số giấy chứng nhận đăng ký", {
                required: registered,
                max: 100,
              })}
              {text("establishedDate", "Ngày thành lập", { type: "date" })}
              <label className="reg-field" htmlFor="reg-provinceCode">
                <span id="reg-provinceCode-label">
                  Tỉnh / thành phố <b aria-hidden="true">*</b>
                </span>
                <select
                  className="input"
                  id="reg-provinceCode"
                  aria-labelledby="reg-provinceCode-label"
                  value={draft.provinceCode}
                  {...fieldAttributes("provinceCode")}
                  onBlur={() => validateField("provinceCode")}
                  onChange={(e) => {
                    const province = addresses.find(
                      (p) => p.code === e.target.value,
                    );
                    setDraft((d) => ({
                      ...d,
                      provinceCode: province?.code ?? "",
                      province: province?.name ?? "",
                      wardCode: "",
                      ward: "",
                    }));
                    setFieldErrors((current) => ({
                      ...current,
                      provinceCode: undefined,
                      wardCode: undefined,
                    }));
                  }}
                >
                  <option value="">Chọn tỉnh / thành phố</option>
                  {addresses.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {fieldError("provinceCode")}
                {addressError && (
                  <p className="reg-field-error" role="alert">
                    {addressError}
                  </p>
                )}
              </label>
              <label className="reg-field" htmlFor="reg-wardCode">
                <span id="reg-wardCode-label">
                  Xã / phường <b aria-hidden="true">*</b>
                </span>
                <select
                  className="input"
                  id="reg-wardCode"
                  aria-labelledby="reg-wardCode-label"
                  value={draft.wardCode}
                  disabled={!draft.provinceCode}
                  {...fieldAttributes("wardCode")}
                  onBlur={() => validateField("wardCode")}
                  onChange={(e) => {
                    const ward = addresses
                      .find((p) => p.code === draft.provinceCode)
                      ?.wards.find((w) => w.code === e.target.value);
                    setDraft((d) => ({
                      ...d,
                      wardCode: ward?.code ?? "",
                      ward: ward?.name ?? "",
                    }));
                    setFieldErrors((current) => ({
                      ...current,
                      wardCode: undefined,
                    }));
                  }}
                >
                  <option value="">Chọn xã / phường</option>
                  {addresses
                    .find((p) => p.code === draft.provinceCode)
                    ?.wards.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.name}
                      </option>
                    ))}
                </select>
                {fieldError("wardCode")}
              </label>
              {text("address", "Địa chỉ trụ sở / nơi hoạt động", {
                required: true,
                full: true,
                max: 500,
                placeholder: "Số nhà, đường, thôn / ấp",
              })}
              {text("website", "Website", {
                type: "url",
                full: true,
                placeholder: "https://… (không bắt buộc)",
              })}
              <div className="reg-inline-note reg-full">
                <ShieldCheck size={18} />
                <span>
                  {registered
                    ? "Tài liệu pháp lý giúp quản trị viên đối chiếu thông tin đăng ký."
                    : "Hộ/cá nhân sản xuất có thể gửi hồ sơ khi chưa có mã số thuế hoặc giấy đăng ký."}{" "}
                  Không yêu cầu tải ảnh CCCD.
                </span>
              </div>
              {upload("LEGAL_REGISTRATION", registered)}
              <details className="reg-extra reg-full">
                <summary>
                  Thêm logo tổ chức <span>Không bắt buộc</span>
                </summary>
                {upload("LOGO")}
              </details>
            </>
          )}
          {step === 1 && (
            <>
              <div className="reg-section-title reg-full">
                <Building2 size={20} />
                <h2>Người đại diện / chủ hồ sơ</h2>
              </div>
              {text("representative", "Họ tên người đại diện", {
                required: true,
              })}
              {text("representativeTitle", "Chức vụ", {
                required: registered,
                max: 100,
                placeholder: "Giám đốc, chủ hộ, người sản xuất…",
              })}
              {text("phone", "Số điện thoại liên hệ", {
                required: true,
                type: "tel",
                max: 30,
              })}
              {text("contactEmail", "Email liên hệ", {
                required: true,
                type: "email",
              })}
              <div className="reg-section-title reg-full">
                <ShieldCheck size={20} />
                <h2>Tài khoản quản trị viên chính</h2>
              </div>
              <label className="reg-check reg-full">
                <input
                  type="checkbox"
                  checked={draft.sameRepresentative}
                  onChange={(e) =>
                    update("sameRepresentative", e.target.checked)
                  }
                />
                <span>
                  Quản trị viên chính cũng là người đại diện — dùng cùng họ tên
                  và email liên hệ
                </span>
              </label>
              {text("fullName", "Họ tên quản trị viên", { required: true })}
              {text("email", "Email đăng nhập", {
                required: true,
                type: "email",
              })}
              {text("password", "Mật khẩu", {
                required: true,
                type: "password",
                max: 72,
              })}
              {text("passwordConfirm", "Xác nhận mật khẩu", {
                required: true,
                type: "password",
                max: 72,
              })}
              <p className="reg-help reg-full">
                Ít nhất 12 ký tự, gồm chữ và số, tối đa 72 byte UTF-8. Email
                đăng nhập sẽ được xác thực ở bước cuối.
              </p>
              {select(
                "registrantRelationship",
                "Người thực hiện đăng ký",
                [
                  ["REPRESENTATIVE", "Tôi là người đại diện / chủ hồ sơ"],
                  ["AUTHORIZED", "Tôi được ủy quyền đăng ký"],
                ],
                true,
                true,
              )}
              {draft.registrantRelationship === "AUTHORIZED" &&
                upload("AUTHORIZATION", true)}
            </>
          )}
          {step === 2 && (
            <>
              <div className="reg-full" {...fieldAttributes("activities")}>
                <h2 className="reg-label">
                  Hoạt động của tổ chức <b>*</b>
                </h2>
                <p className="reg-help">
                  Có thể chọn nhiều hoạt động. Các hoạt động sẽ được xét duyệt
                  theo hồ sơ.
                </p>
                <div className="reg-choice-grid">
                  {ACTIVITY_OPTIONS.map(([code, label]) => {
                    const Icon = icons[code];
                    return (
                      <label
                        key={code}
                        className={`reg-choice${draft.activities.includes(code) ? " is-selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={draft.activities.includes(code)}
                          onChange={(e) => {
                            const activities = e.target.checked
                              ? [...draft.activities, code]
                              : draft.activities.filter((a) => a !== code);
                            setDraft((d) => ({
                              ...d,
                              activities,
                              organizationType: activities.includes(
                                d.organizationType,
                              )
                                ? d.organizationType
                                : (activities[0] ?? ""),
                            }));
                          }}
                        />
                        <Icon size={25} />
                        <span>{label}</span>
                        <span className="reg-choice-mark" aria-hidden="true">
                          {draft.activities.includes(code) && (
                            <Check size={13} />
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {fieldError("activities")}
              </div>
              {select(
                "organizationType",
                "Hoạt động chính",
                ACTIVITY_OPTIONS.filter(([code]) =>
                  draft.activities.includes(code),
                ),
                true,
                true,
              )}
              {producer && (
                <>
                  <div className="reg-section-title reg-full">
                    <Sprout size={20} />
                    <h2>Thông tin sản xuất</h2>
                  </div>
                  <label className="reg-field" htmlFor="reg-sector">
                    <span>
                      Lĩnh vực sản xuất <b>*</b>
                    </span>
                    <select
                      id="reg-sector"
                      className="input"
                      defaultValue="CROP"
                    >
                      <option value="CROP">Trồng trọt</option>
                    </select>
                  </label>
                  {text("productGroups", "Nhóm sản phẩm chính", {
                    required: true,
                    max: 1000,
                    placeholder: "Ví dụ: rau, trái cây, gạo",
                  })}
                  <p className="reg-help reg-full">
                    Ngăn cách các nhóm sản phẩm bằng dấu phẩy. Hồ sơ hiện tiếp
                    nhận hoạt động trồng trọt; thông tin cơ sở chi tiết được bổ
                    sung sau xét duyệt.
                  </p>
                  <details className="reg-extra reg-full">
                    <summary>
                      Mã vùng trồng, quy mô và cơ sở dự kiến <span>Nếu có</span>
                    </summary>
                    <div className="reg-fields">
                      {text("growingAreaCode", "Mã số vùng trồng", {
                        max: 100,
                      })}
                      {text("packingFacilityCode", "Mã cơ sở đóng gói", {
                        max: 100,
                      })}
                      {text("scaleEstimate", "Quy mô sản xuất dự kiến", {
                        max: 200,
                        placeholder: "Ví dụ: 5 ha trồng rau",
                      })}
                      {text("facilityCount", "Số cơ sở dự kiến", {
                        type: "number",
                        min: 1,
                      })}
                    </div>
                  </details>
                  <fieldset className="reg-certifications reg-full">
                    <legend>
                      Chứng nhận đang có <small>— không bắt buộc</small>
                    </legend>
                    <div>
                      {CERTIFICATION_OPTIONS.map(([code, label]) => (
                        <label className="reg-check" key={code}>
                          <input
                            type="checkbox"
                            checked={draft.certifications.includes(code)}
                            onChange={(e) =>
                              update(
                                "certifications",
                                e.target.checked
                                  ? [...draft.certifications, code]
                                  : draft.certifications.filter(
                                      (c) => c !== code,
                                    ),
                              )
                            }
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {draft.certifications.length > 0 &&
                    upload("CERTIFICATE", true)}
                </>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <div className="reg-full">
                <h2 className="reg-label">
                  Dịch vụ bạn muốn sử dụng <b>*</b>
                </h2>
                <div className="reg-service-choices">
                  {INTEREST_OPTIONS.map(([code, label]) => (
                    <label className="reg-check" key={code}>
                      <input
                        type="checkbox"
                        checked={
                          code === "TRACEABILITY" ||
                          draft.interests.includes(code)
                        }
                        disabled={code === "TRACEABILITY"}
                        onChange={(e) =>
                          update("interests", [
                            "TRACEABILITY",
                            ...(e.target.checked ? ["QR_LABELS"] : []),
                          ])
                        }
                      />
                      <span>
                        {label}
                        {code === "TRACEABILITY" && <small>Bắt buộc</small>}
                      </span>
                    </label>
                  ))}
                </div>
                {fieldError("interests")}
              </div>
              {select(
                "hostingMode",
                "Hình thức vận hành",
                [
                  ["MANAGED_ORG", "AgriTrace quản lý hạ tầng"],
                  ["SELF_MANAGED_ORG", "Doanh nghiệp tự vận hành hạ tầng"],
                ],
                true,
              )}
              {select("planCode", "Gói dịch vụ quan tâm", [
                ["", "Chưa xác định — tư vấn sau xét duyệt"],
                ["TRACE_5", "Truy xuất 5 sản phẩm"],
                ["TRACE_10", "Truy xuất 10 sản phẩm"],
                ["TRACE_20", "Truy xuất 20 sản phẩm"],
              ])}
              {select("expectedProducts", "Số sản phẩm dự kiến", [
                ["UNDECIDED", "Chưa xác định"],
                ["UP_TO_10", "1–10 sản phẩm"],
                ["UP_TO_100", "11–100 sản phẩm"],
                ["OVER_100", "Trên 100 sản phẩm"],
              ])}
              {text("expectedLotsPerMonth", "Số lô dự kiến / tháng", {
                type: "number",
                min: 1,
                placeholder: "Không bắt buộc",
              })}
              {select(
                "partnerIntent",
                "Kết nối đối tác chuỗi",
                [
                  ["LATER", "Chưa cần / thực hiện sau"],
                  ["YES", "Có nhu cầu kết nối"],
                ],
                false,
                true,
              )}
              <label
                className="reg-field reg-full"
                htmlFor="reg-integrationNotes"
              >
                <span id="reg-integrationNotes-label">
                  Yêu cầu tích hợp hoặc hỗ trợ bổ sung
                </span>
                <textarea
                  id="reg-integrationNotes"
                  aria-labelledby="reg-integrationNotes-label"
                  className="input"
                  rows={3}
                  maxLength={1000}
                  placeholder="Ví dụ: cần tư vấn kết nối ERP/WMS/API… (không bắt buộc)"
                  value={draft.integrationNotes}
                  onChange={(e) => update("integrationNotes", e.target.value)}
                  onBlur={() => validateField("integrationNotes")}
                  {...fieldAttributes("integrationNotes")}
                />
                {fieldError("integrationNotes")}
              </label>
              <label className="reg-field reg-full" htmlFor="reg-description">
                <span id="reg-description-label">
                  Giới thiệu ngắn về tổ chức
                </span>
                <textarea
                  id="reg-description"
                  aria-labelledby="reg-description-label"
                  className="input"
                  rows={3}
                  maxLength={2000}
                  placeholder="Sản phẩm, địa bàn hoạt động hoặc thông tin bổ sung (không bắt buộc)"
                  value={draft.description}
                  onChange={(e) => update("description", e.target.value)}
                  onBlur={() => validateField("description")}
                  {...fieldAttributes("description")}
                />
                {fieldError("description")}
              </label>
              <div className="reg-inline-note reg-full">
                <ShieldCheck size={19} />
                <span>
                  Bước này ghi nhận lựa chọn dịch vụ, chưa tạo hợp đồng hoặc thu
                  tiền. Báo giá và cấu hình kết nối được hoàn thiện sau xét
                  duyệt; chưa cần chọn chuỗi khi đăng ký.
                </span>
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <RegistrationReview draft={draft} files={files} onEdit={move} />
              <div className="reg-otp-grid reg-full">
                {emails.map((email) => (
                  <RegistrationEmailOtp
                    key={email}
                    email={email}
                    label={
                      emails.length === 1
                        ? "Email tài khoản và liên hệ"
                        : email === draft.email.trim().toLowerCase()
                          ? "Email đăng nhập"
                          : "Email liên hệ"
                    }
                    registrationId={registrationId.current}
                    proof={proofs[email]}
                    onVerified={(proof) => {
                      setProofs((current) => ({ ...current, [email]: proof }));
                      setFieldErrors((current) => ({
                        ...current,
                        emailVerification: undefined,
                      }));
                    }}
                  />
                ))}
              </div>
              <div className="reg-full">{fieldError("emailVerification")}</div>
              <div className="reg-consents reg-full">
                <label className="reg-check">
                  <input
                    type="checkbox"
                    checked={draft.declaration}
                    {...fieldAttributes("declaration")}
                    onChange={(e) => update("declaration", e.target.checked)}
                  />
                  <span>
                    Tôi xác nhận thông tin chính xác và có thẩm quyền đăng ký hồ
                    sơ này. <b>*</b>
                  </span>
                </label>
                {fieldError("declaration")}
                <label className="reg-check">
                  <input
                    type="checkbox"
                    checked={draft.termsAccepted}
                    {...fieldAttributes("termsAccepted")}
                    onChange={(e) => update("termsAccepted", e.target.checked)}
                  />
                  <span>
                    Tôi đồng ý với{" "}
                    <Link
                      href="/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Điều khoản sử dụng
                    </Link>
                    . <b>*</b>
                  </span>
                </label>
                {fieldError("termsAccepted")}
                <label className="reg-check">
                  <input
                    type="checkbox"
                    checked={draft.privacyAcknowledged}
                    {...fieldAttributes("privacyAcknowledged")}
                    onChange={(e) =>
                      update("privacyAcknowledged", e.target.checked)
                    }
                  />
                  <span>
                    Tôi đã đọc{" "}
                    <Link
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Chính sách quyền riêng tư
                    </Link>
                    . <b>*</b>
                  </span>
                </label>
                {fieldError("privacyAcknowledged")}
                <label className="reg-check reg-marketing">
                  <input
                    type="checkbox"
                    checked={draft.marketingAccepted}
                    onChange={(e) =>
                      update("marketingAccepted", e.target.checked)
                    }
                  />
                  <span>
                    Tôi muốn nhận tin giới thiệu dịch vụ từ AgriTrace.{" "}
                    <small>Không bắt buộc</small>
                  </span>
                </label>
              </div>
            </>
          )}
        </fieldset>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {frozen && (
          <p className="notice" role="status">
            Yêu cầu đã gửi chưa rõ kết quả. Giữ nguyên trang và thử lại hồ sơ
            ban đầu để đối soát.
          </p>
        )}
        <footer className="reg-actions">
          <div>
            {step > 0 && (
              <button
                type="button"
                className="button secondary"
                disabled={pending || frozen}
                onClick={() => move(step - 1)}
              >
                <ArrowLeft size={17} /> Quay lại
              </button>
            )}
            <button
              type="button"
              className="reg-save"
              disabled={pending || frozen}
              onClick={saveDraft}
            >
              <Save size={17} /> Lưu nháp
            </button>
          </div>
          <button className="button reg-next" type="submit" disabled={pending}>
            {pending
              ? uploadStatus || "Đang xử lý…"
              : frozen
                ? "Thử lại hồ sơ ban đầu"
                : step === 4
                  ? "Gửi hồ sơ xét duyệt"
                  : "Tiếp tục"}
            {!pending && <ArrowRight size={17} />}
          </button>
        </footer>
      </form>
      <p className="reg-bottom-note">
        <ShieldCheck size={15} /> Hồ sơ được bảo vệ và chỉ dùng cho việc đăng
        ký, xét duyệt và cung cấp dịch vụ.
      </p>
    </div>
  );
}
