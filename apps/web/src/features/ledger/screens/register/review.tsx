import { Fields, Field } from "@/components/ledger/kit/page";
import { t } from "@/lib/ledger/i18n";
import type {
  RegistrationDraft,
  RegistrationFiles,
} from "@/lib/registration-form";
const labels: Partial<Record<keyof RegistrationDraft, string>> = {
  registrationRole: "Vai trò đăng ký",
  organizationName: "Tên tổ chức / chủ thể",
  legalForm: "Loại chủ thể",
  participationModel: "Mô hình tham gia",
  organizationType: "Loại tổ chức",
  activities: "Năng lực yêu cầu",
  businessId: "Mã số thuế",
  registrationNumber: "Số giấy đăng ký",
  establishedDate: "Ngày thành lập",
  address: "Địa chỉ chi tiết",
  province: "Tỉnh / thành phố",
  ward: "Xã / phường",
  website: "Website",
  representative: "Người đại diện / chủ hồ sơ",
  representativeTitle: "Chức vụ người đại diện",
  phone: "Số điện thoại",
  contactEmail: "Email liên hệ",
  registrantRelationship: "Người thực hiện đăng ký",
  fullName: "Họ tên quản trị viên",
  email: "Email đăng nhập",
  productGroups: "Nhóm sản phẩm",
  growingAreaCode: "Mã vùng trồng",
  packingFacilityCode: "Mã cơ sở đóng gói",
  scaleEstimate: "Quy mô dự kiến",
  facilityCount: "Số cơ sở dự kiến",
  certifications: "Chứng nhận sản xuất",
  processingTypes: "Loại hình chế biến",
  foodSafetyCertificateNumber: "Số giấy chứng nhận an toàn thực phẩm",
  foodSafetyCertificateExpiry: "Hạn giấy chứng nhận",
  processingFacilityCode: "Mã cơ sở chế biến",
  dailyCapacityKg: "Công suất (kg/ngày)",
  processingCertifications: "Chứng nhận chế biến",
  hostingMode: "Mô hình peer quan tâm",
  interests: "Dịch vụ quan tâm",
  planCode: "Gói quan tâm",
  expectedProducts: "Số sản phẩm dự kiến",
  expectedLotsPerMonth: "Số lô dự kiến mỗi tháng",
  partnerIntent: "Nhu cầu tìm đối tác",
  integrationNotes: "Nhu cầu hỗ trợ tích hợp",
  description: "Giới thiệu tổ chức",
};
export function RegistrationReview({
  draft,
  files,
}: {
  draft: RegistrationDraft;
  files: RegistrationFiles;
}) {
  return (
    <Fields>
      {Object.entries(labels).map(([key, label]) => {
        const value = draft[key as keyof RegistrationDraft];
        const text = Array.isArray(value)
          ? value.join(", ")
          : String(value ?? "");
        return text ? (
          <Field key={key} label={t(label)}>
            {text}
          </Field>
        ) : null;
      })}
      <Field label={t("Tài liệu")}>
        {Object.values(files)
          .flatMap((selected) => (selected ? [selected.file.name] : []))
          .join(", ") || t("Không có tài liệu")}
      </Field>
    </Fields>
  );
}
