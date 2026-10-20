export type AddressProvince = {
  code: string;
  name: string;
  wards: Array<{ code: string; name: string }>;
};
export const REGISTRATION_STEPS = [
  "Vai trò & doanh nghiệp",
  "Đại diện & tài khoản",
  "Thông tin hoạt động",
  "Dịch vụ sử dụng",
  "Kiểm tra & gửi hồ sơ",
];
export const LEGAL_FORM_OPTIONS = [
  ["ENTERPRISE", "Doanh nghiệp"],
  ["COOPERATIVE", "Hợp tác xã"],
  ["HOUSEHOLD_BUSINESS", "Hộ kinh doanh có đăng ký"],
  ["PRODUCER_HOUSEHOLD", "Hộ nông dân sản xuất"],
  ["INDIVIDUAL_PRODUCER", "Cá nhân sản xuất"],
] as const;
export const ACTIVITY_OPTIONS = [
  ["FARM", "Nhà sản xuất/HTX"],
  ["TRANSPORTER", "Nhà vận chuyển"],
  ["PROCESSOR", "Nhà chế biến"],
  ["DISTRIBUTOR", "Nhà phân phối"],
  ["RETAILER", "Nhà bán lẻ"],
] as const;
/** The role chosen first; it fixes the participation model and activities. */
export const REGISTRATION_ROLES = [
  ["FARM", "Nhà sản xuất / Hợp tác xã", "Trồng trọt, thu hoạch và tạo lô nông sản. Mua gói dịch vụ và tạo chuỗi truy xuất."],
  ["PROCESSOR", "Nhà chế biến", "Sơ chế, đóng gói, chế biến lô nông sản. Tham gia chuỗi khi được mời."],
  ["TRANSPORTER", "Nhà vận chuyển", "Nhận và giao lô hàng giữa các khâu. Tham gia chuỗi khi được mời."],
  ["DISTRIBUTOR", "Nhà phân phối", "Nhập kho, lưu kho và phân phối lô hàng. Tham gia chuỗi khi được mời."],
  ["RETAILER", "Nhà bán lẻ", "Nhận hàng, bán lẻ và ghi nhận tiêu thụ. Tham gia chuỗi khi được mời."],
  ["SUPPLY_CHAIN", "Doanh nghiệp có chuỗi cung ứng", "Một tổ chức có đăng ký vận hành toàn bộ vai trò: sản xuất, chế biến, vận chuyển, phân phối và bán lẻ."],
] as const;
export type RegistrationRole = (typeof REGISTRATION_ROLES)[number][0];
const ALL_ACTIVITIES = ["FARM", "PROCESSOR", "TRANSPORTER", "DISTRIBUTOR", "RETAILER"];
/** Draft fields derived from the chosen registration role. */
export function registrationRoleFields(role: string) {
  return role === "SUPPLY_CHAIN"
    ? {
        participationModel: "SUPPLY_CHAIN_ENTERPRISE",
        activities: [...ALL_ACTIVITIES],
        organizationType: "FARM",
      }
    : { participationModel: "SINGLE", activities: [role], organizationType: role };
}
/** Households and individual producers may only register as producers. */
export const legalFormsFor = (role: string) =>
  LEGAL_FORM_OPTIONS.filter(
    ([code]) => role === "FARM" || registeredLegalForm(code),
  );
export const PARTICIPATION_OPTIONS = [
  ["SINGLE", "Một vai trò trong chuỗi", "Nhà sản xuất/HTX mua gói và tạo chuỗi; vận chuyển, chế biến, phân phối, bán lẻ tham gia miễn phí khi được mời."],
  ["SUPPLY_CHAIN_ENTERPRISE", "Doanh nghiệp chuỗi cung ứng", "Một tổ chức có đăng ký vận hành nhiều khâu (sản xuất, chế biến, vận chuyển, phân phối, bán lẻ). Mua gói Doanh nghiệp chuỗi; từng năng lực được xét duyệt riêng."],
] as const;
export const PROCESSING_TYPE_OPTIONS = [
  ["PRELIMINARY", "Sơ chế"],
  ["PACKING", "Đóng gói"],
  ["DRYING", "Sấy"],
  ["FREEZING", "Cấp đông"],
  ["MILLING", "Xay xát"],
  ["JUICE_EXTRACT", "Ép, chiết"],
  ["FERMENTING", "Lên men"],
  ["OTHER", "Khác"],
] as const;
export const PROCESSING_CERT_OPTIONS = [
  ["HACCP", "HACCP"],
  ["ISO22000", "ISO 22000"],
  ["FSSC22000", "FSSC 22000"],
  ["OTHER", "Khác"],
] as const;
/** Producers/cooperatives and supply-chain enterprises buy a plan. */
export const payingDraft = (model: string, activities: string[]) =>
  model === "SUPPLY_CHAIN_ENTERPRISE" || activities.includes("FARM");
export const INTEREST_OPTIONS = [
  ["TRACEABILITY", "Truy xuất nguồn gốc"],
  ["QR_LABELS", "Tem QR theo lô"],
] as const;
export const CERTIFICATION_OPTIONS = [
  ["VIETGAP", "VietGAP"],
  ["GLOBALGAP", "GlobalG.A.P."],
  ["ORGANIC", "Hữu cơ"],
  ["OTHER", "Chứng nhận khác"],
] as const;
export const registeredLegalForm = (value: string) =>
  ["ENTERPRISE", "COOPERATIVE", "HOUSEHOLD_BUSINESS"].includes(value);
export const registrationDefaults = {
  organizationName: "",
  legalForm: "ENTERPRISE",
  businessId: "",
  registrationNumber: "",
  establishedDate: "",
  provinceCode: "",
  province: "",
  wardCode: "",
  ward: "",
  address: "",
  website: "",
  representative: "",
  representativeTitle: "",
  phone: "",
  contactEmail: "",
  fullName: "",
  email: "",
  sameRepresentative: false,
  registrantRelationship: "REPRESENTATIVE",
  registrationRole: "FARM",
  participationModel: "SINGLE",
  activities: ["FARM"] as string[],
  organizationType: "FARM",
  processingTypes: [] as string[],
  foodSafetyCertificateNumber: "",
  foodSafetyCertificateExpiry: "",
  processingFacilityCode: "",
  dailyCapacityKg: "",
  processingCertifications: [] as string[],
  productGroups: "",
  growingAreaCode: "",
  packingFacilityCode: "",
  scaleEstimate: "",
  facilityCount: "",
  certifications: [] as string[],
  interests: ["TRACEABILITY"] as string[],
  hostingMode: "MANAGED_ORG",
  planCode: "",
  expectedProducts: "UNDECIDED",
  expectedLotsPerMonth: "",
  partnerIntent: "LATER",
  integrationNotes: "",
  description: "",
  declaration: false,
  termsAccepted: false,
  privacyAcknowledged: false,
  marketingAccepted: false,
};
export type RegistrationDraft = typeof registrationDefaults;
export type DocumentKind =
  "LOGO" | "LEGAL_REGISTRATION" | "AUTHORIZATION" | "CERTIFICATE";
export type RegistrationFiles = Partial<
  Record<DocumentKind, { id: string; file: File }>
>;
export type RegistrationField =
  keyof RegistrationDraft | DocumentKind | "emailVerification";
export type RegistrationErrors = Partial<Record<RegistrationField, string>>;
const goodText = (s: string, min: number, max: number) =>
  s.trim().length >= min &&
  s.length <= max &&
  ![...s].some((c) => {
    const code = c.charCodeAt(0);
    return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
  });
export const isRegistrationEmailValid = (s: string) =>
  s.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
export function validateRegistrationStep(
  d: RegistrationDraft,
  step: number,
  addresses: AddressProvince[],
  files: RegistrationFiles,
): RegistrationErrors {
  const errors: RegistrationErrors = {};
  if (step === 0) {
    if (!REGISTRATION_ROLES.some(([code]) => code === d.registrationRole))
      errors.registrationRole = "Chọn vai trò đăng ký của tổ chức.";
    if (!goodText(d.organizationName, 2, 255))
      errors.organizationName = "Tên tổ chức/chủ thể cần từ 2 đến 255 ký tự.";
    if (!legalFormsFor(d.registrationRole).some(([code]) => code === d.legalForm))
      errors.legalForm =
        d.registrationRole === "SUPPLY_CHAIN"
          ? "Doanh nghiệp có chuỗi cung ứng cần là tổ chức có đăng ký kinh doanh."
          : "Chọn loại chủ thể phù hợp với vai trò đăng ký.";
    if (registeredLegalForm(d.legalForm) && !d.businessId.trim())
      errors.businessId = "Nhập mã số thuế của tổ chức.";
    if (
      registeredLegalForm(d.legalForm) &&
      !goodText(d.registrationNumber, 1, 100)
    )
      errors.registrationNumber = "Nhập số giấy chứng nhận đăng ký.";
    if (
      d.businessId.trim() &&
      !/^(?:\d{10}(?:-?\d{3})?|\d{12})$/.test(d.businessId.trim())
    )
      errors.businessId = "Mã số thuế cần 10, 12 hoặc 13 số theo loại chủ thể.";
    if (
      ["ENTERPRISE", "COOPERATIVE"].includes(d.legalForm) &&
      /^\d{12}$/.test(d.businessId.trim())
    )
      errors.businessId = "Doanh nghiệp/HTX dùng mã số thuế 10 hoặc 13 số.";
    const province = addresses.find((p) => p.code === d.provinceCode),
      ward = province?.wards.find((w) => w.code === d.wardCode);
    if (!province || province.name !== d.province)
      errors.provinceCode = "Chọn tỉnh / thành phố trong danh mục.";
    if (!ward || ward.name !== d.ward)
      errors.wardCode = "Chọn xã / phường thuộc tỉnh / thành phố đã chọn.";
    if (!goodText(d.address, 5, 500))
      errors.address = "Điền địa chỉ chi tiết từ 5 đến 500 ký tự.";
    if (d.establishedDate) {
      const date = new Date(d.establishedDate + "T00:00:00Z");
      if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== d.establishedDate ||
        d.establishedDate >
          new Date().toLocaleDateString("en-CA", {
            timeZone: "Asia/Ho_Chi_Minh",
          })
      )
        errors.establishedDate =
          "Ngày thành lập không hợp lệ hoặc nằm trong tương lai.";
    }
    if (d.website) {
      try {
        const u = new URL(d.website);
        if (
          !["https:", "http:"].includes(u.protocol) ||
          !u.hostname.includes(".") ||
          u.username ||
          u.password ||
          d.website.length > 255
        )
          throw Error();
      } catch {
        errors.website = "Website cần địa chỉ http:// hoặc https:// hợp lệ.";
      }
    }
    if (registeredLegalForm(d.legalForm) && !files.LEGAL_REGISTRATION)
      errors.LEGAL_REGISTRATION =
        "Đính kèm giấy đăng ký của tổ chức để xét duyệt.";
  }
  if (step === 1) {
    if (!goodText(d.representative, 2, 255))
      errors.representative = "Điền họ tên người đại diện / chủ hồ sơ.";
    if (
      registeredLegalForm(d.legalForm) &&
      !goodText(d.representativeTitle, 2, 100)
    )
      errors.representativeTitle = "Điền chức vụ người đại diện.";
    if (
      !/^(?:0[35789]\d{8}|02\d{9}|\+84(?:[35789]\d{8}|2\d{9}))$/.test(
        d.phone.replace(/[ .()-]/g, ""),
      )
    )
      errors.phone = "Nhập số điện thoại liên hệ Việt Nam hợp lệ.";
    if (!isRegistrationEmailValid(d.contactEmail))
      errors.contactEmail = "Nhập email liên hệ hợp lệ.";
    if (!isRegistrationEmailValid(d.email))
      errors.email = "Nhập email đăng nhập hợp lệ.";
    if (!goodText(d.fullName, 2, 255))
      errors.fullName = "Điền họ tên quản trị viên từ 2 đến 255 ký tự.";
    if (d.registrantRelationship === "AUTHORIZED" && !files.AUTHORIZATION)
      errors.AUTHORIZATION =
        "Đính kèm giấy ủy quyền khi đăng ký thay người đại diện.";
    if (!["REPRESENTATIVE", "AUTHORIZED"].includes(d.registrantRelationship))
      errors.registrantRelationship = "Chọn người thực hiện đăng ký.";
  }
  if (step === 2) {
    if (
      !d.activities.length ||
      d.activities.some((a) => !ACTIVITY_OPTIONS.some(([code]) => code === a))
    )
      errors.activities = "Chọn ít nhất một hoạt động của tổ chức.";
    if (!d.activities.includes(d.organizationType))
      errors.organizationType =
        "Chọn hoạt động chính trong các hoạt động đã đăng ký.";
    if (d.participationModel === "SINGLE" && d.activities.length !== 1)
      errors.activities =
        "Mô hình một vai trò chọn đúng một hoạt động; chọn Doanh nghiệp chuỗi cung ứng để đăng ký nhiều năng lực.";
    if (d.participationModel === "SUPPLY_CHAIN_ENTERPRISE") {
      if (d.activities.length < 2)
        errors.activities = "Doanh nghiệp chuỗi cung ứng chọn ít nhất hai năng lực.";
      if (!registeredLegalForm(d.legalForm))
        errors.activities = "Doanh nghiệp chuỗi cung ứng cần là tổ chức có đăng ký kinh doanh.";
    }
    if (d.activities.includes("PROCESSOR")) {
      if (!d.processingTypes.length)
        errors.processingTypes = "Chọn ít nhất một loại hình chế biến.";
      if (!goodText(d.foodSafetyCertificateNumber, 1, 100))
        errors.foodSafetyCertificateNumber = "Nhập số giấy chứng nhận cơ sở đủ điều kiện an toàn thực phẩm.";
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.foodSafetyCertificateExpiry) || d.foodSafetyCertificateExpiry <= today)
        errors.foodSafetyCertificateExpiry = "Giấy chứng nhận phải còn hiệu lực.";
      if (d.dailyCapacityKg && (!/^\d+$/.test(d.dailyCapacityKg) || Number(d.dailyCapacityKg) < 1))
        errors.dailyCapacityKg = "Công suất là số nguyên dương (kg/ngày).";
      if (!files.CERTIFICATE)
        errors.CERTIFICATE = "Đính kèm giấy chứng nhận cơ sở đủ điều kiện an toàn thực phẩm.";
    }
    if (!registeredLegalForm(d.legalForm) && !d.activities.includes("FARM"))
      errors.activities =
        "Hộ / cá nhân sản xuất cần chọn hoạt động Nhà sản xuất.";
    if (d.activities.includes("FARM")) {
      const groups = d.productGroups
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (
        !groups.length ||
        groups.length > 10 ||
        groups.some((s) => s.length > 100)
      )
        errors.productGroups =
          "Điền 1–10 nhóm sản phẩm, ngăn cách bằng dấu phẩy.";
      if (
        d.facilityCount &&
        (!/^\d+$/.test(d.facilityCount) ||
          Number(d.facilityCount) < 1 ||
          Number(d.facilityCount) > 10000)
      )
        errors.facilityCount = "Số cơ sở dự kiến cần từ 1 đến 10.000.";
      if (d.certifications.length && !files.CERTIFICATE)
        errors.CERTIFICATE = "Đính kèm tài liệu cho chứng nhận đã khai báo.";
    }
  }
  if (step === 3) {
    if (
      !d.interests.includes("TRACEABILITY") ||
      d.interests.some(
        (value) => !["TRACEABILITY", "QR_LABELS"].includes(value),
      )
    )
      errors.interests =
        "Dịch vụ Truy xuất nguồn gốc là bắt buộc; có thể chọn thêm Tem QR theo lô.";
    if (
      d.expectedLotsPerMonth &&
      (!/^\d+$/.test(d.expectedLotsPerMonth) ||
        Number(d.expectedLotsPerMonth) < 1 ||
        Number(d.expectedLotsPerMonth) > 1000000)
    )
      errors.expectedLotsPerMonth = "Số lô/tháng cần từ 1 đến 1.000.000.";
    if (d.integrationNotes.length > 1000)
      errors.integrationNotes = "Nội dung hỗ trợ bổ sung tối đa 1.000 ký tự.";
    if (d.description.length > 2000)
      errors.description = "Giới thiệu tối đa 2.000 ký tự.";
  }
  if (step === 4) {
    if (!d.declaration)
      errors.declaration = "Xác nhận tính chính xác và thẩm quyền đăng ký.";
    if (!d.termsAccepted)
      errors.termsAccepted = "Cần đồng ý với điều khoản sử dụng.";
    if (!d.privacyAcknowledged)
      errors.privacyAcknowledged = "Xác nhận đã đọc chính sách quyền riêng tư.";
  }
  return errors;
}
