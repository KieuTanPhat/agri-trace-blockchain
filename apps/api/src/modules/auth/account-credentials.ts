import { hash } from 'bcrypt';
import type { Prisma } from '../../generated/prisma/client.js';
import { encryptOtp } from '../enterprise-onboarding/registration-otp.service.js';
import { temporaryPassword } from '../enterprise-onboarding/registration-email.js';

/**
 * A temporary password for an account someone else creates. The plaintext
 * only leaves through the encrypted mail queue; the account must replace it.
 */
export async function temporaryCredential() {
  const password = temporaryPassword();
  return { password, passwordHash: await hash(password, 12) };
}

/** Queues the sign-in mail; the Worker clears the ciphertext once sent. */
export async function queueAccountCredentials(
  tx: Prisma.TransactionClient,
  account: { id: string; email: string; fullName: string },
  password: string,
  context: string,
) {
  await tx.enterpriseMail.create({
    data: {
      userId: account.id,
      kind: 'ACCOUNT_CREDENTIALS',
      recipient: account.email,
      subject: 'AgriTrace — Tài khoản đăng nhập của bạn',
      text: `Xin chào ${account.fullName}. ${context} Đăng nhập bằng email này và mật khẩu tạm dưới đây; hệ thống sẽ yêu cầu đổi mật khẩu ở lần đăng nhập đầu tiên.`,
      otpCiphertext: encryptOtp(password),
    },
  });
}
