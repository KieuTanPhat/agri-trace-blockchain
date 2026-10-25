import { findLocation } from "../locations";
import { normalizePhone, passwordError } from "./validation";

export type RegistrationDraft = {
  phone: string;
  password: string;
  confirmation: string;
  fullName: string;
  contactEmail: string;
  provinceCode: string;
  wardCode: string;
  businessAddress: string;
  consent: boolean;
};
export const emptyRegistration = (): RegistrationDraft => ({
  phone: "",
  password: "",
  confirmation: "",
  fullName: "",
  contactEmail: "",
  provinceCode: "",
  wardCode: "",
  businessAddress: "",
  consent: false,
});
export function credentialErrors(
  draft: Pick<RegistrationDraft, "phone" | "password" | "confirmation">,
) {
  return {
    phone: normalizePhone(draft.phone)
      ? undefined
      : "Số điện thoại chưa hợp lệ.",
    password: passwordError(draft.password),
    confirmation:
      draft.confirmation === draft.password
        ? undefined
        : "Mật khẩu nhập lại chưa khớp.",
  };
}
export function profileErrors(draft: RegistrationDraft) {
  return {
    fullName:
      draft.fullName.trim().length > 0 && draft.fullName.trim().length <= 255
        ? undefined
        : "Nhập họ tên từ 1 đến 255 ký tự.",
    contactEmail:
      !draft.contactEmail.trim() ||
      (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contactEmail.trim()) &&
        draft.contactEmail.trim().length <= 255)
        ? undefined
        : "Email liên hệ chưa hợp lệ.",
    location: findLocation(draft.provinceCode, draft.wardCode)
      ? undefined
      : "Chọn tỉnh/thành và phường/xã thuộc tỉnh/thành đó.",
    businessAddress:
      draft.businessAddress.trim().length <= 255
        ? undefined
        : "Địa chỉ tối đa 255 ký tự.",
    consent: draft.consent
      ? undefined
      : "Cần đồng ý bản giữ chỗ thử nghiệm để tiếp tục thử luồng.",
  };
}
export function changeProvince(
  draft: RegistrationDraft,
  provinceCode: string,
): RegistrationDraft {
  return {
    ...draft,
    provinceCode,
    wardCode: provinceCode === draft.provinceCode ? draft.wardCode : "",
  };
}
