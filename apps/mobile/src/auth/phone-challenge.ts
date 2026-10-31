/** A challenge is memory-only. Resends and back navigation share one cooldown. */
export interface PhoneVerification {
  confirm(code: string): Promise<string>;
  dispose(): Promise<void>;
}
export class PhoneAuthError extends Error {
  constructor(
    message: string,
    readonly code = "PHONE_AUTH",
  ) {
    super(message);
  }
}
export const normalizePhone = (value: string) => {
  const phone = value.replace(/\s+/g, "").replace(/^0/, "+84");
  if (!/^\+84[35789]\d{8}$/.test(phone))
    throw new PhoneAuthError("Số điện thoại Việt Nam chưa đúng.");
  return phone;
};
export function phoneError(error: unknown) {
  if (error instanceof PhoneAuthError) return error.message;
  const code = (error as { code?: string })?.code ?? "";
  if (/too-many-requests|quota-exceeded/.test(code))
    return "Firebase đang giới hạn gửi mã. Dừng gửi lại và thử sau; đổi IP không giải quyết giới hạn này.";
  if (/invalid-verification-code/.test(code))
    return "Mã xác minh chưa đúng. Kiểm tra SMS rồi nhập lại.";
  if (/session-expired|invalid-verification-id/.test(code))
    return "Mã đã hết hiệu lực. Yêu cầu mã mới sau khi hết thời gian chờ.";
  if (
    /app-not-authorized|invalid-app-credential|missing-client-identifier/.test(
      code,
    )
  )
    return "APK chưa được Firebase cho phép. Kiểm tra package, SHA-1/SHA-256 và file cấu hình rồi build lại.";
  if (/billing|operation-not-allowed/.test(code))
    return "Firebase chưa cho phép gửi SMS. Kiểm tra Phone Authentication và billing của dự án.";
  if (/network-request-failed/.test(code))
    return "Không kết nối được Firebase. Kiểm tra mạng và chờ trước khi gửi lại.";
  return "Không hoàn tất xác minh điện thoại. Thử lại sau; không gửi mã liên tục.";
}
export class PhoneChallenge {
  verification: PhoneVerification | null = null;
  phone = "";
  nextSendAt = 0;
  expiresAt = 0;
  private sending = false;
  private confirming = false;
  private epoch = 0;
  constructor(
    private readonly send: (phone: string) => Promise<PhoneVerification>,
    private readonly now = Date.now,
  ) {}
  get seconds() {
    return Math.max(0, Math.ceil((this.nextSendAt - this.now()) / 1000));
  }
  async request(value: string) {
    const phone = normalizePhone(value);
    if (this.sending || this.confirming || this.seconds > 0)
      throw new PhoneAuthError("Chờ hết bộ đếm trước khi gửi lại mã.");
    this.sending = true;
    const epoch = this.epoch;
    // Even a lost response may have sent a billable SMS. Never auto retry it.
    this.nextSendAt = this.now() + 60_000;
    this.verification = null;
    try {
      const verification = await this.send(phone);
      if (epoch !== this.epoch) {
        await verification.dispose();
        throw new PhoneAuthError("Đã đóng phiên xác minh.");
      }
      this.phone = phone;
      this.verification = verification;
      this.expiresAt = this.now() + 5 * 60_000;
    } catch (error) {
      if (
        /too-many-requests|quota-exceeded/.test(
          (error as { code?: string })?.code ?? "",
        )
      )
        this.nextSendAt = this.now() + 15 * 60_000;
      throw error;
    } finally {
      this.sending = false;
    }
  }
  async confirm(code: string) {
    if (this.confirming || this.sending)
      throw new PhoneAuthError("Đang xử lý xác minh.");
    if (!this.verification || this.now() >= this.expiresAt)
      throw new PhoneAuthError(
        "Phiên xác minh đã hết hạn. Yêu cầu mã mới sau khi hết thời gian chờ.",
      );
    if (!/^\d{6}$/.test(code))
      throw new PhoneAuthError("Nhập đủ 6 số trong SMS.");
    this.confirming = true;
    const epoch = this.epoch;
    try {
      const proof = await this.verification.confirm(code);
      if (epoch !== this.epoch)
        throw new PhoneAuthError("Đã đóng phiên xác minh.");
      return proof;
    } finally {
      this.confirming = false;
    }
  }
  async clear() {
    this.epoch++;
    const previous = this.verification;
    this.verification = null;
    this.phone = "";
    this.expiresAt = 0;
    await previous?.dispose().catch(() => undefined);
  }
}
