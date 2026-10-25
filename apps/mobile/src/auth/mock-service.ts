import type { AuthService, PhoneVerifier } from "./types";
import { findLocation } from "../locations";
import { PREVIEW_CONSENT_VERSION } from "./legal-preview";
import { normalizePhone, passwordError } from "./validation";

// This module must be removed from release bundles by the __DEV__ branch.
export const MOCK_AUTH_MARKER = "ACHECK_DEV_AUTH_ONLY_20261019";
export function createMockAuthServices(now = () => Date.now()): {
  auth: AuthService;
  phone: PhoneVerifier;
} {
  let sequence = 0;
  const challenges = new Map<
    string,
    { phone: string; expires: number; attempts: number }
  >();
  const proofs = new Map<string, { phone: string; expires: number }>();
  const nextSend = new Map<string, number>();
  function active(signal: AbortSignal) {
    if (signal.aborted) throw new Error("Yêu cầu đã được hủy.");
  }
  function consume(phone: string, proof: string) {
    const entry = proofs.get(proof);
    if (!entry || entry.phone !== phone || entry.expires <= now())
      throw new Error("Xác nhận đã hết hạn hoặc không khớp số điện thoại.");
    proofs.delete(proof);
  }
  const phone: PhoneVerifier = {
    async send(value, signal) {
      active(signal);
      if (normalizePhone(value) !== value)
        throw new Error("Số điện thoại chưa hợp lệ.");
      if ((nextSend.get(value) ?? 0) > now())
        throw new Error("Vui lòng đợi hết bộ đếm trước khi gửi lại.");
      for (const [id, item] of challenges)
        if (item.phone === value || item.expires <= now())
          challenges.delete(id);
      for (const [id, item] of proofs)
        if (item.phone === value || item.expires <= now()) proofs.delete(id);
      for (const [key, time] of nextSend)
        if (time <= now()) nextSend.delete(key);
      if (challenges.size + proofs.size >= 100)
        throw new Error("Có quá nhiều yêu cầu thử nghiệm. Khởi động lại app.");
      const challengeId = `${MOCK_AUTH_MARKER}-challenge-${++sequence}`;
      challenges.set(challengeId, {
        phone: value,
        expires: now() + 300_000,
        attempts: 0,
      });
      const resendAt = now() + 30_000;
      nextSend.set(value, resendAt);
      return { challengeId, resendAt };
    },
    async confirm(id, code, signal) {
      active(signal);
      const entry = challenges.get(id);
      if (!entry || entry.expires <= now())
        throw new Error("Mã thử đã hết hạn. Vui lòng gửi lại.");
      entry.attempts++;
      if (entry.attempts > 5)
        throw new Error("Đã thử quá nhiều lần. Vui lòng gửi lại mã.");
      if (code !== "123456") throw new Error("Mã thử không đúng.");
      challenges.delete(id);
      const proof = `${MOCK_AUTH_MARKER}-proof-${++sequence}`;
      proofs.set(proof, { phone: entry.phone, expires: entry.expires });
      return proof;
    },
  };
  const auth: AuthService = {
    async login(input, signal) {
      if (signal.aborted) throw new Error("Yêu cầu đã được hủy.");
      if (
        input.phone !== "+84900000000" ||
        input.password !== "Demo-only-1234"
      ) {
        throw new Error("Số điện thoại hoặc mật khẩu không chính xác.");
      }
      return {
        id: MOCK_AUTH_MARKER,
        fullName: "Người dùng thử nghiệm (không phải tài khoản thật)",
        phone: input.phone,
      };
    },
    async logout() {},
    async register(input, signal) {
      active(signal);
      const location = findLocation(input.provinceCode, input.wardCode);
      if (
        !location ||
        input.consentVersion !== PREVIEW_CONSENT_VERSION ||
        !input.fullName.trim() ||
        passwordError(input.password)
      )
        throw new Error("Thông tin đăng ký chưa hợp lệ.");
      consume(input.phone, input.phoneProof);
      return {
        id: `${MOCK_AUTH_MARKER}-profile-${++sequence}`,
        fullName: input.fullName.trim(),
        phone: input.phone,
        contactEmail: input.contactEmail?.trim().toLowerCase() || undefined,
        province: location.province.label,
        ward: location.ward.label,
        businessAddress: input.businessAddress?.trim() || undefined,
      };
    },
    async resetPassword(input, signal) {
      active(signal);
      if (passwordError(input.password))
        throw new Error("Mật khẩu mới chưa hợp lệ.");
      consume(input.phone, input.phoneProof);
      // UI simulation only: no account or password is persisted by the mock.
    },
  };
  return { auth, phone };
}
export function createMockAuthService(): AuthService {
  return createMockAuthServices().auth;
}
