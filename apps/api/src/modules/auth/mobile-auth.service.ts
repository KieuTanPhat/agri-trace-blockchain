import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcrypt';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import {
  FirebasePhoneVerifier,
  type FirebasePhoneProof,
} from './firebase-phone-verifier.js';
import { lockSessionOwner } from './session-family.js';
import type { MobileRegisterDto, MobileResetDto } from './mobile-auth.dto.js';
import locations from '../../common/locations/vietnam.json' with { type: 'json' };
import type { Prisma } from '../../generated/prisma/client.js';

export const DEV_CONSUMER_CONSENT = 'DEV-CONSUMER-TEST-20261020';
@Injectable()
export class MobileAuthService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(FirebasePhoneVerifier)
    private readonly verifier: FirebasePhoneVerifier,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}
  enabled() {
    if (this.config.get('CONSUMER_AUTH_ENABLED') !== 'true')
      throw new ServiceUnavailableException(
        'Tính năng tài khoản tạm chưa sẵn sàng',
      );
  }
  /** Durable cross-instance phone limit; rejected logins also consume an attempt.
   * Only an HMAC identifier is stored (not phone/IP/password). No OTP is sent here.
   */
  async rateLimit(phone: string, operation: string) {
    const keyHash = createHmac(
      'sha256',
      this.config.getOrThrow<string>('JWT_SECRET'),
    )
      .update(`${operation}:${phone}`)
      .digest('hex');
    const rows = await this.db.$queryRaw<Array<{ attempts: number }>>`
      INSERT INTO consumer_auth_limit(key_hash, window_at, attempts) VALUES (${keyHash}, now(), 1)
      ON CONFLICT (key_hash) DO UPDATE SET
        attempts = CASE WHEN consumer_auth_limit.window_at < now() - interval '15 minutes' THEN 1 ELSE consumer_auth_limit.attempts + 1 END,
        window_at = CASE WHEN consumer_auth_limit.window_at < now() - interval '15 minutes' THEN now() ELSE consumer_auth_limit.window_at END
      RETURNING attempts`;
    if (rows[0].attempts > 10)
      throw new HttpException(
        { message: 'Vui lòng thử lại sau 15 phút', retryAfterSeconds: 900 },
        429,
      );
  }
  private async lockPhone(tx: Prisma.TransactionClient, phone: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`consumer:${phone}`}, 0))::text`;
  }
  private async useProof(
    tx: Prisma.TransactionClient,
    proof: FirebasePhoneProof,
  ) {
    const exists = await tx.consumerPhoneProof.findFirst({
      where: {
        OR: [{ tokenHash: proof.tokenHash }, { proofKey: proof.proofKey }],
      },
    });
    if (exists)
      throw new ConflictException(
        'Xác nhận đã được sử dụng. Vui lòng đăng nhập hoặc xác minh lại',
      );
    await tx.consumerPhoneProof.create({ data: proof });
  }
  async register(input: MobileRegisterDto) {
    this.enabled();
    // No production registration against unapproved draft/preview text.
    if (
      this.config.get('NODE_ENV') === 'production' ||
      this.config.get('CONSUMER_DEV_REGISTRATION_ENABLED') !== 'true'
    )
      throw new ServiceUnavailableException(
        'Đăng ký đang chờ chính sách được duyệt',
      );
    if (input.consentVersion !== DEV_CONSUMER_CONSENT)
      throw new UnprocessableEntityException(
        'Phiên bản thông báo thử nghiệm không hợp lệ',
      );
    const province = locations.provinces.find(
      (p) => p.code === input.provinceCode,
    );
    const ward = province?.wards.find((w) => w.code === input.wardCode);
    if (!province || !ward)
      throw new UnprocessableEntityException(
        'Tỉnh/thành và phường/xã không khớp',
      );
    await this.rateLimit(input.phone, 'register');
    const proof = await this.verifier.verify(
      input.firebaseIdToken,
      input.phone,
    );
    const passwordHash = await hash(input.password, 12);
    return this.db.$transaction(async (tx) => {
      await this.lockPhone(tx, input.phone);
      await this.useProof(tx, proof);
      if (await tx.user.findUnique({ where: { phone: input.phone } }))
        throw new ConflictException(
          'Số điện thoại đã đăng ký, vui lòng đăng nhập',
        );
      const role = await tx.role.findUnique({ where: { code: 'CONSUMER' } });
      if (!role)
        throw new ServiceUnavailableException(
          'Tính năng tài khoản tạm chưa sẵn sàng',
        );
      const user = await tx.user.create({
        data: {
          phone: input.phone,
          email: `${input.phone.slice(1)}@phone.invalid`,
          passwordHash,
          fullName: input.fullName,
          roleId: role.id,
          organizationId: null,
          consumerProfile: {
            create: {
              provinceCode: province.code,
              provinceName: province.label,
              wardCode: ward.code,
              wardName: ward.label,
              contactEmail: input.contactEmail,
              businessAddress: input.businessAddress,
              consentVersion: input.consentVersion,
            },
          },
        },
        include: { role: true },
      });
      const session = await this.auth.createAuthResponse(tx, {
        id: user.id,
        email: user.email,
        role: user.role,
      });
      return { ...session, user: await this.profile(tx, user.id) };
    });
  }
  async login(phone: string, password: string, previousRefreshToken?: string) {
    this.enabled();
    await this.rateLimit(phone, 'login');
    const session = await this.auth.loginConsumer(
      phone,
      password,
      previousRefreshToken,
    );
    return { ...session, user: await this.profile(this.db, session.user.id) };
  }
  async refresh(refreshToken: string) {
    this.enabled();
    const session = await this.auth.refresh({ refreshToken }, true);
    return { ...session, user: await this.profile(this.db, session.user.id) };
  }
  async logout(refreshToken: string) {
    this.enabled();
    return this.auth.logout({ refreshToken }, true);
  }
  async reset(input: MobileResetDto) {
    this.enabled();
    await this.rateLimit(input.phone, 'reset');
    const proof = await this.verifier.verify(
      input.firebaseIdToken,
      input.phone,
    );
    const passwordHash = await hash(input.newPassword, 12);
    await this.db.$transaction(async (tx) => {
      await this.lockPhone(tx, input.phone);
      const owner = await tx.user.findUnique({ where: { phone: input.phone } });
      if (!owner)
        throw new UnauthorizedException(
          'Không thể đặt lại mật khẩu với thông tin này',
        );
      await lockSessionOwner(tx, owner.id, owner.organizationId);
      const user = await tx.user.findUnique({
        where: { id: owner.id },
        include: { role: true, consumerProfile: true },
      });
      if (
        !user ||
        user.role.code !== 'CONSUMER' ||
        user.organizationId !== null ||
        user.accountStatus !== 'ACTIVE' ||
        !user.consumerProfile
      )
        throw new UnauthorizedException(
          'Không thể đặt lại mật khẩu với thông tin này',
        );
      await this.useProof(tx, proof);
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { reset: true };
  }
  async me(userId: string) {
    this.enabled();
    return this.profile(this.db, userId);
  }
  private async profile(tx: Prisma.TransactionClient, userId: string) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { role: true, consumerProfile: true },
    });
    if (
      !user ||
      user.role.code !== 'CONSUMER' ||
      user.organizationId !== null ||
      user.accountStatus !== 'ACTIVE' ||
      !user.phone ||
      !user.consumerProfile
    )
      throw new UnauthorizedException('Tài khoản không hợp lệ');
    const profile = user.consumerProfile;
    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      province: profile.provinceName,
      ward: profile.wardName,
      ...(profile.contactEmail ? { contactEmail: profile.contactEmail } : {}),
      ...(profile.businessAddress
        ? { businessAddress: profile.businessAddress }
        : {}),
    };
  }
}
