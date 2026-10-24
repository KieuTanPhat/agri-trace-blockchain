import { Field, Fields } from "@/components/ledger/kit/page";
import { t } from "@/lib/ledger/i18n";
const names: Record<string, string> = {
  formVersion: "Phiên bản hồ sơ",
  legalForm: "Loại chủ thể",
  address: "Địa chỉ",
  province: "Tỉnh / thành phố",
  provinceCode: "Mã tỉnh",
  ward: "Xã / phường",
  wardCode: "Mã xã / phường",
  phone: "Số điện thoại",
  contactEmail: "Email liên hệ",
  representative: "Người đại diện",
  representativeTitle: "Chức vụ",
  registrationNumber: "Số giấy đăng ký",
  establishedDate: "Ngày thành lập",
  registrantRelationship: "Người thực hiện đăng ký",
  activities: "Năng lực",
  website: "Website",
  description: "Giới thiệu tổ chức",
  production: "Thông tin sản xuất",
  processing: "Thông tin chế biến",
  services: "Dịch vụ quan tâm",
  sector: "Lĩnh vực",
  productGroups: "Nhóm sản phẩm",
  growingAreaCode: "Mã vùng trồng",
  packingFacilityCode: "Mã cơ sở đóng gói",
  scaleEstimate: "Quy mô",
  facilityCount: "Số cơ sở",
  certifications: "Chứng nhận",
  processingTypes: "Loại hình chế biến",
  foodSafetyCertificateNumber: "Số giấy an toàn thực phẩm",
  foodSafetyCertificateExpiry: "Hạn giấy an toàn thực phẩm",
  facilityCode: "Mã cơ sở chế biến",
  dailyCapacityKg: "Công suất (kg/ngày)",
  interests: "Dịch vụ",
  planCode: "Gói quan tâm",
  expectedProducts: "Số sản phẩm dự kiến",
  expectedLotsPerMonth: "Số lô dự kiến mỗi tháng",
  partnerIntent: "Nhu cầu tìm đối tác",
  integrationNotes: "Nhu cầu tích hợp",
  documentIds: "Mã tài liệu",
  declarationAccepted: "Xác nhận tính chính xác",
  termsAccepted: "Chấp nhận điều khoản",
  privacyAcknowledged: "Đã đọc chính sách riêng tư",
  marketingAccepted: "Đồng ý tiếp thị",
};
/** Full submitted v2 legal/activity/service information; hierarchy follows the Ledger fields kit. */
export function ProfileDetails({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="flex flex-col divide-y divide-line/70">
      <Fields>
        {Object.entries(data)
          .filter(
            ([, value]) =>
              !value || typeof value !== "object" || Array.isArray(value),
          )
          .map(([key, value]) => (
            <Field key={key} label={t(names[key] ?? key)}>
              {value == null
                ? "—"
                : Array.isArray(value)
                  ? value.map(String).join(", ")
                  : typeof value === "boolean"
                    ? value
                      ? t("Có")
                      : t("Không")
                    : String(value)}
            </Field>
          ))}
      </Fields>
      {Object.entries(data)
        .filter(
          ([, value]) =>
            value && typeof value === "object" && !Array.isArray(value),
        )
        .map(([key, value]) => (
          <div key={key} className="min-w-0">
            <h3 className="px-4 pt-4 text-[13px] font-semibold sm:px-5">
              {t(names[key] ?? key)}
            </h3>
            <ProfileDetails data={value as Record<string, unknown>} />
          </div>
        ))}
    </div>
  );
}
