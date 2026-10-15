import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { hash } from 'bcrypt';
import { canonicalize } from 'json-canonicalize';
import {
  Prisma,
  type EnterpriseEnrollment,
  type EnterpriseConnection,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import type {
  AuthorizedCommand,
  CommandActor,
} from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import {
  organizationGrant,
  lockChainScope,
} from '../supply-chains/chain-policy.js';
import type { RegisterDto } from '../auth/dto/register.dto.js';
import type { EnterpriseConnectionDto, ReviewEnterpriseDto } from './dto.js';

const INCLUDE = {
  organization: true,
  owner: { select: { fullName: true, email: true } },
  connections: { orderBy: { createdAt: 'desc' as const }, take: 100 },
};
const receipt = (id: string) => ({
  enrollmentId: id,
  status: 'PENDING_REVIEW',
});

/** Atomic public registration. HMAC avoids storing a password-derived retry verifier. */
export async function registerEnterprise(
  prisma: PrismaService,
  input: RegisterDto,
  secret: string,
) {
  const normalized = {
    ...input,
    email: input.email.trim().toLowerCase(),
    fullName: input.fullName.trim(),
    organizationName: input.organizationName.trim(),
    businessId: input.businessId.trim().toUpperCase(),
  };
  const digest = createHmac('sha256', secret)
    .update('agritrace:enterprise-registration:1\0')
    .update(canonicalize(normalized))
    .digest('hex');
  const passwordHash = await hash(input.password, 12);
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`enterprise-registration:${input.requestId}`},0))`;
      const old = await tx.enterpriseEnrollment.findUnique({
        where: { id: input.requestId },
      });
      if (old) {
        if (old.registrationDigest !== digest)
          throw new ConflictException('Mã đăng ký đã dùng cho nội dung khác');
        return receipt(old.id);
      }
      const roleCode =
        input.organizationType === 'FARM'
          ? 'FARM_STAFF'
          : input.organizationType;
      const role = await tx.role.findUniqueOrThrow({
        where: { code: roleCode },
      });
      const organization = await tx.organization.create({
        data: {
          name: normalized.organizationName,
          type: input.organizationType,
        },
      });
      // Legacy operator provisioning seeds a primary capability by SQL trigger.
      // Public signup removes that new, still-uncommitted seed before the
      // organization or any dependent records can become visible. Existing
      // organizations/history and operator provisioning are unchanged.
      await tx.organizationCapability.deleteMany({
        where: { organizationId: organization.id },
      });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          roleId: role.id,
          email: normalized.email,
          fullName: normalized.fullName,
          passwordHash,
        },
      });
      await tx.enterpriseEnrollment.create({
        data: {
          id: input.requestId,
          organizationId: organization.id,
          ownerId: user.id,
          registrationDigest: digest,
          businessId: normalized.businessId,
          hostingMode: input.hostingMode,
        },
      });
      return receipt(input.requestId);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      throw new ConflictException('Email hoặc mã doanh nghiệp đã được đăng ký');
    throw error;
  }
}

/** Rechecked before replay and in the command's transaction under actor locks. */
export async function authorizeEnterpriseCommand(
  db: Prisma.TransactionClient,
  input: AuthorizedCommand,
  lock: boolean,
) {
  const actor = input.actor!;
  if (
    input.operation === 'ENTERPRISE_REVIEW' ||
    input.operation === 'ENTERPRISE_CONNECTION_REVIEW'
  ) {
    if (actor.role !== 'SYSTEM_ADMIN')
      throw new ForbiddenException('Chỉ quản trị nền tảng được duyệt');
    return canonicalSha256({
      user: actor.sub,
      role: actor.role,
      operation: input.operation,
    });
  }
  if (input.operation !== 'ENTERPRISE_CONNECT')
    throw new ForbiddenException('Command onboarding không hợp lệ');
  if (lock && actor.organizationId)
    await lockChainScope(db, `org:${actor.organizationId}`);
  if (lock && actor.organizationId)
    await db.$queryRaw`SELECT id FROM enterprise_enrollment WHERE organization_id=${actor.organizationId}::uuid FOR SHARE`;
  const enrollment = await db.enterpriseEnrollment.findUnique({
    where: { ownerId: actor.sub! },
  });
  const grant = await organizationGrant(db, actor, 'ORG_ADMIN');
  if (
    !enrollment ||
    enrollment.organizationId !== actor.organizationId ||
    enrollment.status !== 'APPROVED' ||
    !grant
  )
    throw new ForbiddenException(
      'Doanh nghiệp chưa được duyệt hoặc bạn không quản lý tổ chức này',
    );
  return canonicalSha256({
    user: actor.sub,
    organization: actor.organizationId,
    enrollment: enrollment.id,
    grant: grant.id,
    revision: grant.revision,
  });
}

export function connectionPublicConfig(
  input: EnterpriseConnectionDto,
  mode: string,
) {
  if (mode === 'MANAGED_ORG') {
    if (
      [
        input.peerHost,
        input.peerPort,
        input.peerServerName,
        input.mspId,
        input.tlsCaPem,
      ].some((value) => value !== undefined)
    )
      throw new BadRequestException(
        'Peer do AgriTrace quản lý không nhận cấu hình từ phía doanh nghiệp',
      );
    return {};
  }
  const host = (value: string | undefined) =>
    !!value &&
    (isIP(value) > 0 ||
      /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(
        value,
      ));
  if (
    !host(input.peerHost) ||
    !host(input.peerServerName) ||
    !input.peerPort ||
    !/^[A-Za-z][A-Za-z0-9]{0,99}$/.test(input.mspId ?? '')
  )
    throw new BadRequestException(
      'Cần hostname/IP, cổng, tên TLS và MSP hợp lệ',
    );
  if (
    !input.tlsCaPem ||
    !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/.test(
      input.tlsCaPem,
    )
  )
    throw new BadRequestException(
      'Chỉ nhận một chứng thư TLS CA công khai dạng PEM',
    );
  try {
    const certificate = new X509Certificate(input.tlsCaPem);
    if (
      !certificate.ca ||
      Date.parse(certificate.validTo) <= Date.now() ||
      Date.parse(certificate.validFrom) > Date.now()
    )
      throw new Error('invalid CA');
    return {
      peerHost: input.peerHost!,
      peerPort: input.peerPort,
      peerServerName: input.peerServerName!,
      mspId: input.mspId!,
      tlsCaPem: certificate.toString(),
    };
  } catch {
    throw new BadRequestException('Chứng thư CA không hợp lệ hoặc đã hết hạn');
  }
}

export const connectionView = (row: EnterpriseConnection) => ({
  publicConfig: row.publicConfig,
  id: row.id,
  chainId: row.chainId,
  hostingMode: row.hostingMode,
  status: row.status,
  version: row.version,
  reviewNote: row.reviewNote,
  errorCode: row.errorCode,
  txId: row.txId,
  evidence: row.evidence,
  createdAt: row.createdAt.toISOString(),
  checkedAt: row.checkedAt?.toISOString() ?? null,
});
export const enrollmentView = (
  row: EnterpriseEnrollment & {
    organization: { name: string; type: string };
    owner: { fullName: string; email: string };
    connections: EnterpriseConnection[];
  },
) => ({
  id: row.id,
  organizationId: row.organizationId,
  organizationName: row.organization.name,
  organizationType: row.organization.type,
  representativeName: row.owner.fullName,
  representativeEmail: row.owner.email,
  businessId: row.businessId,
  hostingMode: row.hostingMode,
  status: row.status,
  version: row.version,
  reviewNote: row.reviewNote,
  connections: row.connections.map(connectionView),
});

@Injectable()
export class EnterpriseOnboardingService {
  constructor(private readonly prisma: PrismaService) {}
  async mine(actor: CommandActor) {
    const row = await this.prisma.enterpriseEnrollment.findUnique({
      where: { ownerId: actor.sub! },
      include: INCLUDE,
    });
    if (!row || row.organizationId !== actor.organizationId)
      throw new NotFoundException('Tài khoản này không có hồ sơ tự đăng ký');
    return enrollmentView(row);
  }
  async list(actor: CommandActor) {
    if (actor.role !== 'SYSTEM_ADMIN') throw new ForbiddenException();
    return (
      await this.prisma.enterpriseEnrollment.findMany({
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
    ).map(enrollmentView);
  }
  review(actor: CommandActor, id: string, input: ReviewEnterpriseDto) {
    return commandTransaction(this.prisma, async (tx) => {
      if (actor.role !== 'SYSTEM_ADMIN') throw new ForbiddenException();
      const row = await tx.enterpriseEnrollment.findUniqueOrThrow({
        where: { id },
        include: { organization: true },
      });
      await tx.$queryRaw`SELECT organization_id FROM organization WHERE organization_id=${row.organizationId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT user_id FROM app_user WHERE user_id=${row.ownerId}::uuid FOR SHARE`;
      const owner = await tx.user.findUniqueOrThrow({
        where: { id: row.ownerId },
      });
      if (
        owner.accountStatus !== 'ACTIVE' ||
        owner.organizationId !== row.organizationId
      )
        throw new ConflictException(
          'Tài khoản đại diện không còn hoạt động trong tổ chức',
        );
      if (
        (
          await tx.organization.findUniqueOrThrow({
            where: { id: row.organizationId },
          })
        ).status !== 'ACTIVE'
      )
        throw new ConflictException('Tổ chức đã bị khóa');
      const changed = await tx.enterpriseEnrollment.updateMany({
        where: { id, version: input.version, status: 'PENDING_REVIEW' },
        data: {
          status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          reviewedBy: actor.sub,
          reviewNote: input.note,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('Hồ sơ đã được xử lý; tải lại trạng thái');
      if (input.decision === 'APPROVE') {
        await tx.organizationCapability.create({
          data: {
            organizationId: row.organizationId,
            code: row.organization.type,
          },
        });
        for (const role of ['ORG_ADMIN', 'CREATE_CHAIN'] as const)
          await tx.scopedRoleGrant.create({
            data: {
              userId: row.ownerId,
              organizationId: row.organizationId,
              scope: 'ORGANIZATION',
              role,
            },
          });
      }
      return enrollmentView(
        await tx.enterpriseEnrollment.findUniqueOrThrow({
          where: { id },
          include: INCLUDE,
        }),
      );
    });
  }
  connect(actor: CommandActor, input: EnterpriseConnectionDto) {
    return commandTransaction(this.prisma, async (tx) => {
      const enrollment = await tx.enterpriseEnrollment.findUniqueOrThrow({
        where: { ownerId: actor.sub! },
      });
      const chain = await tx.supplyChain.findUnique({
        where: { id: input.chainId },
      });
      if (chain?.ownerOrganizationId !== actor.organizationId)
        throw new NotFoundException('Không tìm thấy chuỗi thuộc doanh nghiệp');
      const publicConfig = connectionPublicConfig(
        input,
        enrollment.hostingMode,
      );
      const existing = await tx.enterpriseConnection.findUnique({
        where: { id: input.id },
      });
      if (existing) {
        if (
          existing.enrollmentId !== enrollment.id ||
          existing.chainId !== input.chainId ||
          canonicalize(existing.publicConfig) !== canonicalize(publicConfig)
        )
          throw new ConflictException('Mã kết nối đã dùng cho yêu cầu khác');
        return connectionView(existing);
      }
      if (
        await tx.enterpriseConnection.findFirst({
          where: {
            enrollmentId: enrollment.id,
            chainId: chain.id,
            status: { notIn: ['REJECTED', 'FAILED'] },
          },
        })
      )
        throw new ConflictException(
          'Chuỗi đã có yêu cầu kết nối đang hoạt động',
        );
      return connectionView(
        await tx.enterpriseConnection.create({
          data: {
            id: input.id,
            enrollmentId: enrollment.id,
            chainId: chain.id,
            hostingMode: enrollment.hostingMode,
            publicConfig,
          },
        }),
      );
    });
  }
  reviewConnection(
    actor: CommandActor,
    id: string,
    input: ReviewEnterpriseDto,
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      if (actor.role !== 'SYSTEM_ADMIN') throw new ForbiddenException();
      const changed = await tx.enterpriseConnection.updateMany({
        where: { id, version: input.version, status: 'PENDING_REVIEW' },
        data: {
          status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          reviewedBy: actor.sub,
          reviewNote: input.note,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'Yêu cầu đã được xử lý; tải lại trạng thái',
        );
      return connectionView(
        await tx.enterpriseConnection.findUniqueOrThrow({ where: { id } }),
      );
    });
  }
}
