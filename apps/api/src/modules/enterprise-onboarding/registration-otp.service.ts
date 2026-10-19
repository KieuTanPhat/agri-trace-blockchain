import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  Prisma,
  RegistrationEmailVerification,
} from '../../generated/prisma/client.js';
import type {
  RegistrationEmailProof,
  RegistrationOtpRequest,
  RegistrationOtpVerify,
} from './registration-otp.dto.js';
const purpose = 'agritrace:registration-email:v1';
export const otpSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Mail verification secret is not configured');
  return secret;
};
const digest = (secret: string, value: string) =>
  createHmac('sha256', secret)
    .update(purpose + '\0' + value)
    .digest('hex');
const codeDigest = (
  secret: string,
  row: { id: string; registrationId: string; email: string },
  code: string,
) =>
  digest(secret, JSON.stringify([row.id, row.registrationId, row.email, code]));
const proofToken = (secret: string, row: RegistrationEmailVerification) =>
  createHmac('sha256', secret)
    .update(
      purpose +
        ':proof\0' +
        JSON.stringify([row.id, row.registrationId, row.email, row.codeDigest]),
    )
    .digest('base64url');
export function encryptOtp(code: string, secret = otpSecret()) {
  const iv = randomBytes(12),
    key = createHash('sha256')
      .update(purpose + ':cipher\0' + secret)
      .digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(code, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function decryptOtp(value: string, secret = otpSecret()) {
  const packed = Buffer.from(value, 'base64'),
    key = createHash('sha256')
      .update(purpose + ':cipher\0' + secret)
      .digest();
  const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([
    decipher.update(packed.subarray(28)),
    decipher.final(),
  ]).toString('utf8');
}
const valid = (r: RegistrationEmailVerification) =>
  !r.consumedAt &&
  !r.supersededAt &&
  r.expiresAt > new Date() &&
  r.attempts < 5;
const receipt = (r: RegistrationEmailVerification) => ({
  verificationId: r.id,
  expiresAt: r.expiresAt.toISOString(),
  resendAfter: new Date(r.createdAt.getTime() + 60_000).toISOString(),
  queued: true,
});
/** Upload authority is the verified owner email; proof consumption remains atomic with registration. */
export async function assertRegistrationUploadProof(
  tx: Prisma.TransactionClient,
  registrationId: string,
  proof: RegistrationEmailProof,
) {
  const row = await tx.registrationEmailVerification.findUnique({
    where: { id: proof.verificationId },
  });
  if (
    !row ||
    !valid(row) ||
    !row.verifiedAt ||
    row.registrationId !== registrationId
  )
    throw new BadRequestException(
      'Xác thực email quản trị viên trước khi tải tài liệu',
    );
  const expected = Buffer.from(proofToken(otpSecret(), row)),
    actual = Buffer.from(proof.token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new BadRequestException('Xác thực email không hợp lệ');
  return row;
}
export async function consumeRegistrationProofs(
  tx: Prisma.TransactionClient,
  registrationId: string,
  emails: string[],
  proofs: RegistrationEmailProof[],
  secret: string,
) {
  const expected = [
    ...new Set(emails.map((e) => e.trim().toLowerCase())),
  ].sort();
  if (
    proofs.length !== expected.length ||
    new Set(proofs.map((p) => p.verificationId)).size !== proofs.length
  )
    throw new BadRequestException(
      'Xác thực OTP cho email doanh nghiệp và email đăng nhập trước khi gửi',
    );
  const rows: RegistrationEmailVerification[] = [];
  for (const proof of [...proofs].sort((a, b) =>
    a.verificationId.localeCompare(b.verificationId),
  )) {
    await tx.$queryRaw`SELECT id FROM registration_email_verification WHERE id=${proof.verificationId}::uuid FOR UPDATE`;
    const row = await tx.registrationEmailVerification.findUnique({
      where: { id: proof.verificationId },
    });
    if (
      !row ||
      !valid(row) ||
      !row.verifiedAt ||
      row.registrationId !== registrationId ||
      !expected.includes(row.email)
    )
      throw new BadRequestException(
        'Phiên xác thực email không còn hợp lệ; xác thực lại OTP',
      );
    const token = proofToken(secret, row),
      a = Buffer.from(token),
      b = Buffer.from(proof.token);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new BadRequestException('Xác thực email không hợp lệ');
    rows.push(row);
  }
  if (new Set(rows.map((r) => r.email)).size !== expected.length)
    throw new BadRequestException('Thiếu xác thực cho một email trong hồ sơ');
  await tx.registrationEmailVerification.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { consumedAt: new Date() },
  });
}
@Injectable()
export class RegistrationOtpService {
  constructor(private readonly db: PrismaService) {}
  request(input: RegistrationOtpRequest) {
    const secret = otpSecret();
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`registration-otp:${input.email}`},0))`;
      const old = await tx.registrationEmailVerification.findUnique({
        where: { id: input.requestId },
      });
      if (old) {
        if (
          old.email !== input.email ||
          old.registrationId !== input.registrationId
        )
          throw new ConflictException('Mã gửi OTP đã dùng cho nội dung khác');
        return receipt(old);
      }
      const last = await tx.registrationEmailVerification.findFirst({
        where: { email: input.email },
        orderBy: { createdAt: 'desc' },
      });
      const count = await tx.registrationEmailVerification.count({
        where: {
          email: input.email,
          createdAt: { gte: new Date(Date.now() - 3_600_000) },
        },
      });
      if (
        (last && last.createdAt.getTime() + 60_000 > Date.now()) ||
        count >= 5
      )
        throw new HttpException(
          'Chờ ít nhất 60 giây giữa hai lần gửi. Tối đa 5 mã mỗi giờ cho một email.',
          429,
        );
      await tx.registrationEmailVerification.updateMany({
        where: {
          email: input.email,
          registrationId: input.registrationId,
          consumedAt: null,
          supersededAt: null,
        },
        data: { supersededAt: new Date() },
      });
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const row = await tx.registrationEmailVerification.create({
        data: {
          id: input.requestId,
          registrationId: input.registrationId,
          email: input.email,
          codeDigest: codeDigest(
            secret,
            { id: input.requestId, ...input },
            code,
          ),
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      await tx.enterpriseMail.create({
        data: {
          verificationId: row.id,
          kind: 'REGISTRATION_OTP',
          recipient: row.email,
          subject: 'AgriTrace — Mã OTP xác thực đăng ký doanh nghiệp',
          text: 'Xác thực email đăng ký doanh nghiệp AgriTrace. Mã có hiệu lực 10 phút. Không chia sẻ mã với người khác. Nếu bạn không đăng ký, hãy bỏ qua email này.',
          otpCiphertext: encryptOtp(code, secret),
        },
      });
      return receipt(row);
    });
  }
  async verify(input: RegistrationOtpVerify) {
    const secret = otpSecret();
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registration_email_verification WHERE id=${input.verificationId}::uuid FOR UPDATE`;
      const row = await tx.registrationEmailVerification.findUnique({
        where: { id: input.verificationId },
      });
      if (!row || row.registrationId !== input.registrationId || !valid(row))
        return null;
      const attemptDigest = digest(
        secret,
        JSON.stringify([
          input.registrationId,
          input.verificationId,
          input.code,
        ]),
      );
      const old = await tx.registrationOtpAttempt.findUnique({
        where: { id: input.attemptId },
      });
      if (old) {
        if (
          old.verificationId !== row.id ||
          old.requestDigest !== attemptDigest
        )
          throw new ConflictException(
            'Mã thử xác thực đã được dùng cho nội dung khác',
          );
        return old.success && row.verifiedAt ? row : null;
      }
      const a = Buffer.from(row.codeDigest, 'hex'),
        b = Buffer.from(codeDigest(secret, row, input.code), 'hex');
      const success = timingSafeEqual(a, b);
      await tx.registrationOtpAttempt.create({
        data: {
          id: input.attemptId,
          verificationId: row.id,
          requestDigest: attemptDigest,
          success,
        },
      });
      if (!success) {
        await tx.registrationEmailVerification.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 } },
        });
        return null;
      }
      return tx.registrationEmailVerification.update({
        where: { id: row.id },
        data: { verifiedAt: row.verifiedAt ?? new Date() },
      });
    });
    if (!result)
      throw new BadRequestException(
        'Mã OTP không đúng, đã hết hạn hoặc đã vượt 5 lần nhập sai.',
      );
    return {
      verificationId: result.id,
      token: proofToken(secret, result),
      expiresAt: result.expiresAt.toISOString(),
    };
  }
}
