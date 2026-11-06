import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { compare, hash } from 'bcrypt';
import type {
  Prisma,
  StaffPasswordReset,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  lockPlatformAudit,
  appendPlatformAudit,
} from '../platform-governance/platform-audit.js';
import { encryptOtp } from '../enterprise-onboarding/registration-otp.service.js';
import { lockSessionOwner } from './session-family.js';
import type {
  StaffPasswordResetConfirmDto,
  StaffPasswordResetRequestDto,
  StaffPasswordResetVerifyDto,
} from './staff-session.dto.js';

const TTL = 600_000;
const publicMessage =
  'Nếu email thuộc tài khoản nhân viên đang hoạt động, bạn sẽ nhận được mã xác minh. Vui lòng kiểm tra cả thư rác.';
const invalidMessage =
  'Mã không đúng, đã dùng hoặc hết hạn. Vui lòng kiểm tra hoặc yêu cầu mã mới.';
const include = {
  role: { select: { code: true } },
  organization: { select: { status: true } },
} as const;
export const staffResetEligible = (
  user: {
    role: { code: string };
    organizationId: string | null;
    accountStatus: string;
    organization: { status: string } | null;
  } | null,
) =>
  !!user &&
  user.role.code === 'ENTERPRISE_STAFF' &&
  !!user.organizationId &&
  user.accountStatus === 'ACTIVE' &&
  user.organization?.status === 'ACTIVE';
const passwordDigest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function staffResetCodeDigest(
  secret: string,
  row: Pick<StaffPasswordReset, 'id' | 'userId' | 'email' | 'passwordDigest'>,
  code: string,
) {
  return createHmac('sha256', secret)
    .update(
      'agritrace:staff-password-reset:v1\0' +
        JSON.stringify([
          row.id,
          row.userId,
          row.email,
          row.passwordDigest,
          code,
        ]),
    )
    .digest('hex');
}
const active = (row: StaffPasswordReset) =>
  !row.consumedAt &&
  !row.supersededAt &&
  row.attempts < 5 &&
  row.expiresAt > new Date();

// This proof is only issued by verify() after a correct OTP. It is bound to the
// challenge/password snapshot and expires within five minutes (or the OTP TTL).
// Consuming/superseding the challenge invalidates every issued proof.
function resetProof(secret: string, row: StaffPasswordReset, deadline: number) {
  return createHmac('sha256', secret)
    .update(
      'agritrace:staff-password-reset:verified:v1\0' +
        JSON.stringify([
          row.id,
          row.userId,
          row.email,
          row.passwordDigest,
          row.codeDigest,
          deadline,
        ]),
    )
    .digest('hex');
}

@Injectable()
export class StaffPasswordResetService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}
  async request(input: StaffPasswordResetRequestDto) {
    const email = input.email.trim().toLowerCase();
    const secret = this.config.getOrThrow<string>('JWT_SECRET');
    const reply = {
      requestId: input.requestId,
      message: publicMessage,
      resendAfterSeconds: 60,
      expiresInSeconds: 600,
    };
    // Serialize by a non-reversible email fingerprint. All responses are generic.
    const addressKey = createHmac('sha256', secret)
      .update('staff-reset:' + email)
      .digest('hex');
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${addressKey},0))`;
      if (
        await tx.staffPasswordReset.findUnique({
          where: { id: input.requestId },
        })
      )
        return;
      const user = await tx.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        include,
      });
      if (!staffResetEligible(user) || !user) return;
      await lockSessionOwner(tx, user.id, user.organizationId);
      const current = await tx.user.findUnique({
        where: { id: user.id },
        include,
      });
      if (
        !current ||
        !staffResetEligible(current) ||
        current.organizationId !== user.organizationId ||
        current.email.toLowerCase() !== email ||
        current.passwordHash !== user.passwordHash
      )
        return;
      const recent = await tx.staffPasswordReset.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      });
      if (recent && Date.now() - recent.createdAt.getTime() < 60_000) return;
      if (
        (await tx.staffPasswordReset.count({
          where: {
            userId: user.id,
            createdAt: { gte: new Date(Date.now() - 86_400_000) },
          },
        })) >= 10
      )
        return;
      await tx.staffPasswordReset.updateMany({
        where: { userId: user.id, consumedAt: null, supersededAt: null },
        data: { supersededAt: new Date() },
      });
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const base = {
        id: input.requestId,
        userId: user.id,
        email,
        passwordDigest: passwordDigest(user.passwordHash),
      };
      const reset = await tx.staffPasswordReset.create({
        data: {
          ...base,
          codeDigest: staffResetCodeDigest(secret, base, code),
          expiresAt: new Date(Date.now() + TTL),
        },
      });
      await tx.enterpriseMail.create({
        data: {
          userId: user.id,
          staffResetId: reset.id,
          kind: 'STAFF_PASSWORD_RESET',
          recipient: email,
          subject: 'AgriTrace Nhân viên — Mã khôi phục mật khẩu',
          text: 'Bạn vừa yêu cầu khôi phục mật khẩu ứng dụng AgriTrace Nhân viên. Mã có hiệu lực 10 phút và chỉ dùng một lần. Nếu không phải bạn yêu cầu, hãy bỏ qua email này; mật khẩu hiện tại chưa thay đổi.',
          otpCiphertext: encryptOtp(code, secret),
        },
      });
    });
    return reply;
  }
  private async lockedChallenge(
    tx: Prisma.TransactionClient,
    input: StaffPasswordResetRequestDto,
  ) {
    const email = input.email.trim().toLowerCase();
    const initial = await tx.staffPasswordReset.findUnique({
      where: { id: input.requestId },
    });
    if (!initial || initial.email !== email) return null;
    const initialUser = await tx.user.findUnique({
      where: { id: initial.userId },
      include,
    });
    if (!initialUser) return null;
    await lockSessionOwner(tx, initialUser.id, initialUser.organizationId);
    await tx.$queryRaw`SELECT id FROM staff_password_reset WHERE id=${input.requestId}::uuid FOR UPDATE`;
    const row = await tx.staffPasswordReset.findUniqueOrThrow({
      where: { id: input.requestId },
    });
    const user = await tx.user.findUnique({
      where: { id: row.userId },
      include,
    });
    if (
      row.email !== email ||
      !active(row) ||
      !user ||
      !staffResetEligible(user) ||
      user.organizationId !== initialUser.organizationId ||
      user.email.toLowerCase() !== email ||
      passwordDigest(user.passwordHash) !== row.passwordDigest
    )
      return null;
    return { row, user };
  }
  async verify(input: StaffPasswordResetVerifyDto) {
    const secret = this.config.getOrThrow<string>('JWT_SECRET');
    const result = await this.db.$transaction(async (tx) => {
      const challenge = await this.lockedChallenge(tx, input);
      if (!challenge) return null;
      const { row } = challenge;
      const expected = staffResetCodeDigest(secret, row, input.code);
      if (
        !timingSafeEqual(
          Buffer.from(expected, 'hex'),
          Buffer.from(row.codeDigest, 'hex'),
        )
      ) {
        // Commit failed attempts before returning the public error.
        await tx.staffPasswordReset.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 } },
        });
        return null;
      }
      const deadline = Math.min(row.expiresAt.getTime(), Date.now() + 300_000);
      return {
        resetToken: `${deadline}.${resetProof(secret, row, deadline)}`,
        expiresInSeconds: Math.max(
          0,
          Math.floor((deadline - Date.now()) / 1000),
        ),
      };
    });
    if (!result) throw new BadRequestException(invalidMessage);
    return result;
  }
  async confirm(input: StaffPasswordResetConfirmDto) {
    const secret = this.config.getOrThrow<string>('JWT_SECRET');
    // Hash outside the lock; the proof, user and original password are rechecked inside.
    const newHash = await hash(input.newPassword, 12);
    const result = await this.db.$transaction(async (tx) => {
      await lockPlatformAudit(tx);
      const challenge = await this.lockedChallenge(tx, input);
      if (!challenge) return 'invalid';
      const { row, user } = challenge;
      const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(input.resetToken);
      if (!match) return 'invalid';
      const deadline = Number(match[1]);
      if (
        deadline <= Date.now() ||
        deadline > row.expiresAt.getTime() ||
        !timingSafeEqual(
          Buffer.from(match[2], 'hex'),
          Buffer.from(resetProof(secret, row, deadline), 'hex'),
        )
      )
        return 'invalid';
      if (await compare(input.newPassword, user.passwordHash))
        return 'same-password';
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          version: { increment: 1 },
        },
      });
      const revoked = await tx.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.staffPasswordReset.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      });
      await tx.staffPasswordReset.updateMany({
        where: {
          userId: user.id,
          id: { not: row.id },
          consumedAt: null,
          supersededAt: null,
        },
        data: { supersededAt: new Date() },
      });
      await appendPlatformAudit(tx, {
        actor: { sub: user.id, role: user.role.code },
        action: 'STAFF_PASSWORD_RESET',
        subjectType: 'USER',
        subjectId: user.id,
        organizationId: user.organizationId,
        details: { sessionsRevoked: revoked.count },
      });
      return 'changed';
    });
    if (result === 'same-password')
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại');
    if (result !== 'changed') throw new BadRequestException(invalidMessage);
    return { changed: true };
  }
}
