"use client";
import {
  ACTIVITY_OPTIONS,
  CERTIFICATION_OPTIONS,
  LEGAL_FORM_OPTIONS,
  type RegistrationDraft,
  type RegistrationFiles,
} from "@/lib/registration-form";

type Row = { label: string; value: string; full?: boolean };
const labels = (
  options: readonly (readonly [string, string])[],
  values: string[],
) =>
  values
    .map((value) => options.find(([key]) => key === value)?.[1] ?? value)
    .join(", ");
export function RegistrationReview({
  draft,
  files,
  onEdit,
}: {
  draft: RegistrationDraft;
  files: RegistrationFiles;
  onEdit: (step: number) => void;
}) {
  const producer = draft.activities.includes("FARM");
  const groups: { title: string; step: number; rows: Row[] }[] = [
    {
      title: "Thông tin doanh nghiệp",
      step: 0,
      rows: [
        {
          label: "Tên doanh nghiệp / chủ thể",
          value: draft.organizationName,
          full: true,
        },
        {
          label: "Loại hình chủ thể",
          value: labels(LEGAL_FORM_OPTIONS, [draft.legalForm]),
        },
        { label: "Mã số thuế / định danh pháp lý", value: draft.businessId },
        {
          label: "Số giấy chứng nhận đăng ký",
          value: draft.registrationNumber,
        },
        {
          label: "Ngày thành lập",
          value: draft.establishedDate.split("-").reverse().join("/"),
        },
        { label: "Tỉnh / thành phố", value: draft.province },
        { label: "Xã / phường", value: draft.ward },
        {
          label: "Địa chỉ trụ sở / nơi hoạt động",
          value: draft.address,
          full: true,
        },
        { label: "Website", value: draft.website, full: true },
      ],
    },
    {
      title: "Người đại diện và tài khoản",
      step: 1,
      rows: [
        { label: "Họ tên người đại diện", value: draft.representative },
        { label: "Chức vụ", value: draft.representativeTitle },
        { label: "Số điện thoại liên hệ", value: draft.phone },
        { label: "Email liên hệ", value: draft.contactEmail },
        { label: "Họ tên quản trị viên chính", value: draft.fullName },
        { label: "Email đăng nhập", value: draft.email },
        {
          label: "Người thực hiện đăng ký",
          value:
            draft.registrantRelationship === "AUTHORIZED"
              ? "Người được ủy quyền"
              : "Người đại diện / chủ hồ sơ",
          full: true,
        },
      ],
    },
    {
      title: "Hoạt động và sản xuất",
      step: 2,
      rows: [
        {
          label: "Hoạt động đăng ký",
          value: labels(ACTIVITY_OPTIONS, draft.activities),
        },
        {
          label: "Hoạt động chính",
          value: labels(ACTIVITY_OPTIONS, [draft.organizationType]),
        },
        ...(producer
          ? [
              { label: "Lĩnh vực sản xuất", value: "Trồng trọt" },
              { label: "Nhóm sản phẩm chính", value: draft.productGroups },
              { label: "Mã số vùng trồng", value: draft.growingAreaCode },
              { label: "Mã cơ sở đóng gói", value: draft.packingFacilityCode },
              { label: "Quy mô sản xuất dự kiến", value: draft.scaleEstimate },
              { label: "Số cơ sở dự kiến", value: draft.facilityCount },
              {
                label: "Chứng nhận khai báo",
                value: draft.certifications.length
                  ? labels(CERTIFICATION_OPTIONS, draft.certifications)
                  : "Không công bố chứng nhận",
                full: true,
              },
            ]
          : []),
      ],
    },
    {
      title: "Dịch vụ sử dụng",
      step: 3,
      rows: [
        { label: "Dịch vụ chính", value: "Truy xuất nguồn gốc" },
        {
          label: "Tem QR theo lô",
          value: draft.interests.includes("QR_LABELS")
            ? "Đăng ký sử dụng"
            : "Không đăng ký thêm",
        },
        {
          label: "Hình thức vận hành",
          value:
            draft.hostingMode === "MANAGED_ORG"
              ? "AgriTrace quản lý hạ tầng"
              : "Doanh nghiệp tự vận hành hạ tầng",
        },
        {
          label: "Gói dịch vụ quan tâm",
          value: draft.planCode
            ? `Truy xuất ${draft.planCode.replace("TRACE_", "")} sản phẩm`
            : "Tư vấn sau xét duyệt",
        },
        {
          label: "Số sản phẩm dự kiến",
          value: labels(
            [
              ["UNDECIDED", "Chưa xác định"],
              ["UP_TO_10", "1–10 sản phẩm"],
              ["UP_TO_100", "11–100 sản phẩm"],
              ["OVER_100", "Trên 100 sản phẩm"],
            ],
            [draft.expectedProducts],
          ),
        },
        { label: "Số lô dự kiến / tháng", value: draft.expectedLotsPerMonth },
        {
          label: "Kết nối đối tác chuỗi",
          value:
            draft.partnerIntent === "YES"
              ? "Có nhu cầu kết nối"
              : "Thực hiện sau",
          full: true,
        },
        {
          label: "Yêu cầu tích hợp / hỗ trợ",
          value: draft.integrationNotes,
          full: true,
        },
        { label: "Giới thiệu tổ chức", value: draft.description, full: true },
      ],
    },
  ];
  const documents = Object.entries(files).filter(
    ([kind, file]) =>
      file &&
      (kind !== "AUTHORIZATION" ||
        draft.registrantRelationship === "AUTHORIZED") &&
      (kind !== "CERTIFICATE" || producer),
  );
  const fileLabels: Record<string, string> = {
    LOGO: "Logo tổ chức",
    LEGAL_REGISTRATION: "Giấy đăng ký của tổ chức",
    AUTHORIZATION: "Giấy ủy quyền",
    CERTIFICATE: "Tài liệu chứng nhận",
  };
  return (
    <div className="reg-summary reg-full">
      {groups.map((group) => (
        <section
          className="reg-summary-section"
          key={group.step}
          aria-labelledby={`reg-review-${group.step}`}
        >
          <header>
            <h2 id={`reg-review-${group.step}`}>
              <span>{String(group.step + 1).padStart(2, "0")}</span>
              {group.title}
            </h2>
            <button
              type="button"
              aria-label={`Sửa ${group.title.toLowerCase()}`}
              onClick={() => onEdit(group.step)}
            >
              Chỉnh sửa
            </button>
          </header>
          <dl className="reg-summary-grid">
            {group.rows.map((row) => (
              <div
                key={row.label}
                className={`reg-summary-row${row.full ? " reg-summary-long" : ""}`}
              >
                <dt>{row.label}</dt>
                <dd>{row.value.trim() || "Chưa cung cấp"}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <section
        className="reg-summary-section"
        aria-labelledby="reg-review-documents"
      >
        <header>
          <h2 id="reg-review-documents">
            <span>05</span>Tài liệu hồ sơ
          </h2>
        </header>
        {documents.length ? (
          <dl className="reg-summary-grid">
            {documents.map(([kind, file]) => (
              <div className="reg-summary-row reg-summary-long" key={kind}>
                <dt>{fileLabels[kind]}</dt>
                <dd>
                  {file!.file.name}
                  <small>
                    {Math.max(1, Math.ceil(file!.file.size / 1024))} KB
                  </small>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="reg-summary-empty">Không có tài liệu đính kèm.</p>
        )}
      </section>
    </div>
  );
}
