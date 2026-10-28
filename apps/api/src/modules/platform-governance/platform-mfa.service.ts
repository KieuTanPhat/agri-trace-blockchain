import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { compare } from 'bcrypt';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  keyedDigest,
  openSecret,
  platformSecretKey,
  sealSecret,
} from '../../common/crypto/secret-box.js';
import {
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
} from '../../common/crypto/totp.js';
import { appendPlatformAudit, lockPlatformAudit } from './platform-audit.js';
import { mfaMode } from './platform-config.js';
import { MfaStepUpException } from './platform-errors.js';
import { isPlatformAdminRole } from '../auth/role-codes.js';
import {
  lockSessionOwner,
  sessionFamilyWhere,
} from '../auth/session-family.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_COUNT = 10;

function newRecoveryCode() {
  const bytes = randomBytes(10);
  const raw = Array.from(
    bytes,
    (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length],
  ).join('');
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}
const normalizeRecovery = (code: string) =>
  code.replace(/[\s-]/gu, '').toUpperCase();
const aad = (userId: string) => `platform-mfa:${userId}`;

/** A missing or malformed deployment key is an operator problem, not a client
 * error and never a failed sign-in attempt. */
function deploymentKey() {
  try {
    return platformSecretKey();
  } catch {
    throw new ServiceUnavailableException(
      'MFA chưa được cấu hình khóa mã hóa (PLATFORM_SECRET_KEY)',
    );
  }
}
const recoveryDigest = (userId: string, code: string) =>
  keyedDigest(
    'mfa-recovery',
    `${userId}\0${normalizeRecovery(code)}`,
    deploymentKey(),
  );

export interface PlatformActor {
  sub: string;
  role: string;
}

/** `login` failures are 401 (unauthenticated endpoint). `stepup` failures are
 * 403 so the web client keeps the signed-in session, and are not journaled. */
type FactorContext = 'login' | 'stepup';
const rejection = (context: FactorContext, message: string) =>
  context === 'login'
    ? new UnauthorizedException(message)
    : new MfaStepUpException(message);

@Injectable()
export class PlatformMfaService {
  constructor(private readonly prisma: PrismaService) {}

  async status(actor: PlatformActor) {
    const row = await this.prisma.platformMfa.findUnique({
      where: { userId: actor.sub },
    });
    const hashes = (row?.recoveryCodeHashes as string[] | undefined) ?? [];
    return {
      mode: mfaMode(),
      status: (row?.status ?? 'NONE') as 'NONE' | 'PENDING' | 'ENABLED',
      enabledAt: row?.enabledAt ?? null,
      recoveryCodesRemaining: row?.status === 'ENABLED' ? hashes.length : 0,
    };
  }

  /** Starts (or restarts) enrolment. A stolen access token alone must not let
   * an attacker bind their own authenticator, so the password is re-checked.
   * The seed is returned once; only its AES-GCM ciphertext is stored. */
  async enroll(actor: PlatformActor, email: string, password: string) {
    this.assertEnabled();
    const key = deploymentKey();
    const account = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: { passwordHash: true },
    });
    if (!account || !(await compare(password, account.passwordHash)))
      throw new MfaStepUpException('Mật khẩu hiện tại không chính xác');
    return this.prisma.$transaction(async (tx) => {
      await lockPlatformAudit(tx);
      const existing = await tx.platformMfa.findUnique({
        where: { userId: actor.sub },
      });
      if (existing?.status === 'ENABLED')
        throw new ConflictException(
          'MFA đã được bật; tắt trước khi đăng ký lại',
        );
      const secret = generateTotpSecret();
      const secretCiphertext = sealSecret(secret, aad(actor.sub), key);
      await tx.platformMfa.upsert({
        where: { userId: actor.sub },
        create: { userId: actor.sub, secretCiphertext, status: 'PENDING' },
        update: { secretCiphertext, status: 'PENDING', lastUsedStep: null },
      });
      await appendPlatformAudit(tx, {
        actor,
        action: 'MFA_ENROLLMENT_STARTED',
        subjectType: 'USER',
        subjectId: actor.sub,
      });
      return { secret, otpauthUri: otpauthUri(secret, email) };
    });
  }

  /** Confirms the first code, enables MFA and issues recovery codes (shown once). */
  async verifyEnrollment(actor: PlatformActor, code: string) {
    this.assertEnabled();
    const key = deploymentKey();
    return this.prisma.$transaction(async (tx) => {
      await lockPlatformAudit(tx);
      await tx.$queryRaw`SELECT user_id FROM platform_mfa WHERE user_id = ${actor.sub}::uuid FOR UPDATE`;
      const row = await tx.platformMfa.findUnique({
        where: { userId: actor.sub },
      });
      if (!row || row.status !== 'PENDING')
        throw new ConflictException('Chưa có đăng ký MFA đang chờ xác nhận');
      const step = verifyTotp(
        openSecret(row.secretCiphertext, aad(actor.sub), key),
        code,
      );
      if (step === null)
        throw new UnprocessableEntityException('Mã xác thực không đúng');
      const recoveryCodes = Array.from(
        { length: RECOVERY_COUNT },
        newRecoveryCode,
      );
      await tx.platformMfa.update({
        where: { userId: actor.sub },
        data: {
          status: 'ENABLED',
          enabledAt: new Date(),
          lastUsedStep: BigInt(step),
          recoveryCodeHashes: recoveryCodes.map((value) =>
            recoveryDigest(actor.sub, value),
          ),
        },
      });
      await appendPlatformAudit(tx, {
        actor,
        action: 'MFA_ENABLED',
        subjectType: 'USER',
        subjectId: actor.sub,
        details: { recoveryCodes: RECOVERY_COUNT },
      });
      return { enabled: true, recoveryCodes };
    });
  }

  async disable(actor: PlatformActor, code: string) {
    this.assertEnabled();
    if (mfaMode() === 'REQUIRED')
      throw new ConflictException(
        'Chính sách đang bắt buộc MFA cho quản trị viên',
      );
    return this.prisma.$transaction(async (tx) => {
      await lockPlatformAudit(tx);
      const method = await this.verifySecondFactor(
        tx,
        actor.sub,
        code,
        'stepup',
      );
      await tx.platformMfa.delete({ where: { userId: actor.sub } });
      await appendPlatformAudit(tx, {
        actor,
        action: 'MFA_DISABLED',
        subjectType: 'USER',
        subjectId: actor.sub,
        details: { method },
      });
      return { enabled: false };
    });
  }

  /** Replaces recovery codes without disabling the enrolled factor. This also
   * works under REQUIRED after an operator key rotation invalidated old HMACs. */
  async regenerateRecoveryCodes(actor: CommandActor, code: string) {
    this.assertEnabled();
    deploymentKey();
    return this.prisma.$transaction(async (tx) => {
      await lockPlatformAudit(tx);
      if (!actor.sub || !actor.sid || !isPlatformAdminRole(actor.role))
        throw new MfaStepUpException('Cần phiên quản trị đang hoạt động');
      const userId = actor.sub;
      await lockSessionOwner(tx, actor.sub, actor.organizationId, 'read');
      const current = await tx.user.findUnique({
        where: { id: actor.sub },
        include: { role: true, organization: { select: { status: true } } },
      });
      if (
        !current ||
        current.accountStatus !== 'ACTIVE' ||
        current.role.code !== actor.role ||
        current.organizationId !== actor.organizationId ||
        (current.organizationId && current.organization?.status !== 'ACTIVE') ||
        !(await tx.refreshSession.findFirst({
          where: {
            ...sessionFamilyWhere(actor.sid),
            userId: actor.sub,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        }))
      )
        throw new MfaStepUpException('Phiên hoặc quyền quản trị đã thay đổi');
      const method = await this.verifySecondFactor(
        tx,
        actor.sub,
        code,
        'stepup',
      );
      const recoveryCodes = Array.from(
        { length: RECOVERY_COUNT },
        newRecoveryCode,
      );
      await tx.platformMfa.update({
        where: { userId },
        data: {
          recoveryCodeHashes: recoveryCodes.map((value) =>
            recoveryDigest(userId, value),
          ),
        },
      });
      await appendPlatformAudit(tx, {
        actor,
        action: 'MFA_RECOVERY_REGENERATED',
        subjectType: 'USER',
        subjectId: actor.sub,
        details: { method, count: recoveryCodes.length },
      });
      return { enabled: true, recoveryCodes };
    });
  }

  async isEnabled(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
  ) {
    const row = await db.platformMfa.findUnique({ where: { userId } });
    return row?.status === 'ENABLED';
  }

  /** Verifies a TOTP (once per time step) or a single-use recovery code and
   * consumes it. Runs on the caller's transaction so a rejected command rolls
   * the consumption back. */
  async verifySecondFactor(
    tx: Prisma.TransactionClient,
    userId: string,
    code: string | undefined,
    context: FactorContext,
  ): Promise<'TOTP' | 'RECOVERY'> {
    await tx.$queryRaw`SELECT user_id FROM platform_mfa WHERE user_id = ${userId}::uuid FOR UPDATE`;
    const row = await tx.platformMfa.findUnique({ where: { userId } });
    if (!row || row.status !== 'ENABLED')
      throw new ForbiddenException('Tài khoản chưa bật MFA');
    const value = code?.trim();
    if (!value) throw rejection(context, 'Cần mã xác thực hai yếu tố');
    const key = deploymentKey();
    if (/^\d{6}$/u.test(value)) {
      const step = verifyTotp(
        openSecret(row.secretCiphertext, aad(userId), key),
        value,
      );
      if (
        step === null ||
        (row.lastUsedStep !== null && BigInt(step) <= row.lastUsedStep)
      )
        throw rejection(context, 'Mã xác thực không đúng hoặc đã dùng');
      await tx.platformMfa.update({
        where: { userId },
        data: { lastUsedStep: BigInt(step) },
      });
      return 'TOTP';
    }
    const digest = recoveryDigest(userId, value);
    const hashes = (row.recoveryCodeHashes as string[]) ?? [];
    if (!hashes.includes(digest))
      throw rejection(context, 'Mã xác thực không đúng hoặc đã dùng');
    await tx.platformMfa.update({
      where: { userId },
      data: { recoveryCodeHashes: hashes.filter((item) => item !== digest) },
    });
    return 'RECOVERY';
  }

  /** Step-up for high-risk operations. Enrolled administrators must present a
   * fresh code; under REQUIRED an unenrolled administrator is refused. */
  async assertStepUp(
    tx: Prisma.TransactionClient,
    actor: PlatformActor,
    code: string | undefined,
  ) {
    const mode = mfaMode();
    if (mode === 'OFF' || !isPlatformAdminRole(actor.role)) return;
    if (await this.isEnabled(tx, actor.sub)) {
      await this.verifySecondFactor(tx, actor.sub, code, 'stepup');
      return;
    }
    if (mode === 'REQUIRED')
      throw new MfaStepUpException(
        'Cần bật MFA trước khi thực hiện thao tác rủi ro cao',
      );
  }

  /** Login gate. Returns normally when MFA is not required for this account. */
  async assertLogin(
    tx: Prisma.TransactionClient,
    user: { id: string; role: string },
    code: string | undefined,
  ) {
    if (mfaMode() === 'OFF' || !isPlatformAdminRole(user.role)) return;
    if (!(await this.isEnabled(tx, user.id))) return;
    await this.verifySecondFactor(tx, user.id, code, 'login');
  }

  private assertEnabled() {
    if (mfaMode() === 'OFF')
      throw new ForbiddenException('MFA đang bị tắt bởi cấu hình triển khai');
  }
}
