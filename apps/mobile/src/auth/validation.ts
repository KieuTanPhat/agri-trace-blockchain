// Format validation only; ownership is verified by Firebase in stage B.
export function normalizePhone(value: string): string | null {
  const phone = value.trim();
  if (/^0\d{9}$/.test(phone)) return `+84${phone.slice(1)}`;
  return /^\+84\d{9}$/.test(phone) ? phone : null;
}
/** Matches UTF-8 encoding without relying on Node Buffer / native TextEncoder. */
export function utf8Bytes(value: string): number {
  let size = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return size;
}
export function passwordError(value: string): string | undefined {
  if (Array.from(value).length < 12) return "Mật khẩu cần ít nhất 12 ký tự.";
  if (utf8Bytes(value) > 72)
    return "Mật khẩu không được vượt quá 72 byte UTF-8.";
  return undefined;
}
export function validateLogin(phone: string, password: string) {
  return {
    phone: normalizePhone(phone)
      ? undefined
      : "Nhập số điện thoại dạng 0xxxxxxxxx hoặc +84xxxxxxxxx.",
    // Login must not apply the registration policy to existing credentials.
    password: !password
      ? "Vui lòng nhập mật khẩu."
      : utf8Bytes(password) > 72
        ? "Mật khẩu không được vượt quá 72 byte UTF-8."
        : undefined,
  };
}
