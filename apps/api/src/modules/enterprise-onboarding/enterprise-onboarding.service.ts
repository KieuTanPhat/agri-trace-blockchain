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
import type { EnterpriseConnectionDto, ReviewEnterpriseDto, ActivateEnterpriseDto } from './dto.js';
import { VIETNAM_ADDRESSES } from './address-catalog.js';
import { serviceStage } from './enterprise-service.service.js';
import { grantEnterpriseBusiness } from './service-activation.js';
import { consumeRegistrationProofs } from './registration-otp.service.js';
import {
  REGISTERED_FORMS,
  REGISTRATION_POLICY_VERSION,
} from './registration-profile.dto.js';
import { registrationDocumentSelect } from './registration-document.dto.js';
import {
  appendPlatformAudit,
  lockPlatformAudit,
} from '../platform-governance/platform-audit.js';
import {
  APPROVAL_REQUIRED_MESSAGE,
  approvalsMode,
} from '../platform-governance/platform-config.js';

const INCLUDE = {
  organization: {
    include: {
      profile: true,
      registrationDocuments: { select: registrationDocumentSelect },
    },
  },
  owner: { select: { fullName: true, email: true } },
  connections: { orderBy: { createdAt: 'desc' as const }, take: 100 },
  serviceOrder: true,
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
    businessId: input.businessId?.trim().replace('-', '') || null,
  };
  const details = input.details;
  if (
    /^\d{12}$/.test(normalized.businessId ?? '') &&
    ['ENTERPRISE', 'COOPERATIVE'].includes(details?.legalForm)
  )
    throw new BadRequestException(
      'Mã 12 số chỉ dành cho hộ kinh doanh sử dụng số định danh thay mã số thuế',
    );
  const province = VIETNAM_ADDRESSES.find(
    (p) => p.code === details?.provinceCode,
  );
  const ward = province?.wards.find((w) => w.code === details?.wardCode);
  if (
    !details ||
    !province ||
    !ward ||
    province.name !== details.province ||
    ward.name !== details.ward
  )
    throw new BadRequestException(
      'Chọn tỉnh/thành và xã/phường hợp lệ trong danh mục; không nhập tay',
    );
  const registered = REGISTERED_FORMS.includes(details.legalForm);
  if (
    registered &&
    (!normalized.businessId ||
      !details.registrationNumber?.trim() ||
      !details.representativeTitle?.trim())
  )
    throw new BadRequestException(
      'Tổ chức có đăng ký cần mã số thuế, số giấy đăng ký và chức vụ người đại diện',
    );
  if (
    ['PRODUCER_HOUSEHOLD', 'INDIVIDUAL_PRODUCER'].includes(details.legalForm) &&
    !details.activities.includes('FARM')
  )
    throw new BadRequestException(
      'Hộ/cá nhân sản xuất cần chọn hoạt động sản xuất',
    );
  if (details.activities.includes('FARM') && !details.production)
    throw new BadRequestException('Bổ sung lĩnh vực và nhóm sản phẩm sản xuất');
  if (!details.activities.includes('FARM') && details.production)
    throw new BadRequestException(
      'Chỉ khai báo sản xuất khi chọn hoạt động sản xuất',
    );
  if (details.establishedDate) {
    const date = new Date(details.establishedDate + 'T00:00:00Z');
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== details.establishedDate ||
      details.establishedDate > today
    )
      throw new BadRequestException(
        'Ngày thành lập không hợp lệ hoặc nằm trong tương lai',
      );
  }
  for (const value of [
    details.address,
    details.representative,
    input.organizationName,
    input.fullName,
  ])
    if (
      value.trim().length < 2 ||
      [...value].some((c) => {
        const n = c.charCodeAt(0);
        return n === 127 || (n < 32 && ![9, 10, 13].includes(n));
      })
    )
      throw new BadRequestException(
        'Thông tin không được chỉ có khoảng trắng hoặc chứa ký tự điều khiển',
      );
  if (details.address.trim().length < 5)
    throw new BadRequestException('Địa chỉ hoặc giới thiệu quá ngắn');
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
      if (
        (await tx.user.findFirst({
          where: { email: normalized.email },
          select: { id: true },
        })) ||
        (normalized.businessId &&
          (await tx.enterpriseEnrollment.findUnique({
            where: { businessId: normalized.businessId },
            select: { id: true },
          })))
      )
        throw new ConflictException(
          'Email hoặc mã doanh nghiệp đã được đăng ký',
        );
      await consumeRegistrationProofs(
        tx,
        input.requestId,
        [normalized.email, input.details.contactEmail],
        input.emailVerifications,
        secret,
      );
      const documents = await tx.enterpriseRegistrationDocument.findMany({
        where: { id: { in: details.documentIds } },
      });
      if (
        documents.length !== details.documentIds.length ||
        documents.some(
          (d) =>
            d.registrationId !== input.requestId || d.organizationId !== null,
        )
      )
        throw new BadRequestException(
          'Tài liệu không thuộc hồ sơ đang đăng ký',
        );
      const verifiedOwners = await tx.registrationEmailVerification.findMany({
        where: {
          id: { in: documents.map((d) => d.verificationId) },
          registrationId: input.requestId,
          email: normalized.email,
        },
        select: { id: true },
      });
      if (
        documents.some(
          (d) => !verifiedOwners.some((v) => v.id === d.verificationId),
        )
      )
        throw new BadRequestException(
          'Tài liệu cần được tải bằng email quản trị của hồ sơ',
        );
      for (const kind of ['LOGO', 'LEGAL_REGISTRATION', 'AUTHORIZATION'])
        if (documents.filter((d) => d.kind === kind).length > 1)
          throw new BadRequestException(
            'Mỗi loại giấy tờ chỉ nhận một file; có thể ghép các trang thành PDF',
          );
      if (registered && !documents.some((d) => d.kind === 'LEGAL_REGISTRATION'))
        throw new BadRequestException('Tải giấy đăng ký của tổ chức');
      if (
        details.registrantRelationship === 'AUTHORIZED' &&
        !documents.some((d) => d.kind === 'AUTHORIZATION')
      )
        throw new BadRequestException(
          'Tải giấy ủy quyền khi đăng ký thay người đại diện',
        );
      if (
        details.production?.certifications.length &&
        !documents.some((d) => d.kind === 'CERTIFICATE')
      )
        throw new BadRequestException(
          'Đính kèm tài liệu cho chứng nhận đã khai báo',
        );
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
          enterpriseTier: 1,
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
          activationRequired: true,
        },
      });
      if (input.details) {
        if (!input.details.activities.includes(input.organizationType))
          throw new BadRequestException(
            'Hoạt động chính phải nằm trong các hoạt động đăng ký',
          );
        const {
          declarationAccepted: _declaration,
          formVersion,
          registrationNumber,
          establishedDate,
          representativeTitle,
          registrantRelationship,
          production,
          services,
          documentIds: _documentIds,
          termsAccepted,
          privacyAcknowledged,
          marketingAccepted,
          ...details
        } = input.details;
        const acceptedAt = new Date();
        await tx.enterpriseProfile.create({
          data: {
            organizationId: organization.id,
            ...details,
            declarationAcceptedAt: acceptedAt,
            registrationData: JSON.parse(
              JSON.stringify({
                formVersion,
                registrationNumber,
                establishedDate,
                representativeTitle,
                registrantRelationship,
                production,
                services,
                termsAccepted,
                privacyAcknowledged,
                marketingAccepted: marketingAccepted ?? false,
                termsVersion: REGISTRATION_POLICY_VERSION,
                privacyVersion: REGISTRATION_POLICY_VERSION,
                acceptedAt: acceptedAt.toISOString(),
              }),
            ),
          },
        });
      }
      await tx.enterpriseRegistrationDocument.updateMany({
        where: {
          id: { in: details.documentIds },
          organizationId: null,
          registrationId: input.requestId,
        },
        data: { organizationId: organization.id },
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
    input.operation === 'ENTERPRISE_REVIEW' || input.operation === 'ENTERPRISE_ACTIVATE' || input.operation === 'ENTERPRISE_PROFILE_REVIEW' ||
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
  if (
    input.operation !== 'ENTERPRISE_CONNECT' &&
    !['ENTERPRISE_SERVICE_ORDER', 'ENTERPRISE_SERVICE_PAY'].includes(
      input.operation,
    )
  )
    throw new ForbiddenException('Command onboarding không hợp lệ');
  if (lock && actor.organizationId)
    await lockChainScope(db, `org:${actor.organizationId}`);
  if (lock && actor.organizationId)
    await db.$queryRaw`SELECT id FROM enterprise_enrollment WHERE organization_id=${actor.organizationId}::uuid FOR SHARE`;
  const enrollment = await db.enterpriseEnrollment.findUnique({
    where: { ownerId: actor.sub! },
  });
  const grant = await organizationGrant(db, actor, 'ORG_ADMIN');
  const serviceCommand = [
    'ENTERPRISE_SERVICE_ORDER',
    'ENTERPRISE_SERVICE_PAY',
  ].includes(input.operation);
  if (
    !enrollment ||
    enrollment.organizationId !== actor.organizationId ||
    enrollment.status !== 'APPROVED' ||
    (!serviceCommand && !grant)
  )
    throw new ForbiddenException(
      'Doanh nghiệp chưa được duyệt hoặc bạn không quản lý tổ chức này',
    );
  return canonicalSha256({
    user: actor.sub,
    organization: actor.organizationId,
    enrollment: enrollment.id,
    grant: serviceCommand ? null : (grant?.id ?? null),
    revision: serviceCommand ? null : (grant?.revision ?? null),
    activationRequired: enrollment.activationRequired,
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
    organization: {
      name: string;
      type: string;
      profile?: unknown;
      registrationDocuments?: unknown[];
    };
    owner: { fullName: string; email: string };
    connections: EnterpriseConnection[];
    serviceOrder?: { status: string; hostingMode: string } | null;
  },
) => ({
  id: row.id,
  organizationId: row.organizationId,
  organizationName: row.organization.name,
  organizationType: row.organization.type,
  representativeName: row.owner.fullName,
  representativeEmail: row.owner.email,
  businessId: row.businessId,
  details: row.organization.profile ?? null,
  documents: row.organization.registrationDocuments ?? [],
  hostingMode: row.serviceOrder?.hostingMode ?? row.hostingMode,
  onboardingStage: serviceStage(row),
  serviceActivatedAt: row.serviceActivatedAt?.toISOString() ?? null,
  serviceActivationReason: row.serviceActivationReason,
  status: row.status,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  reviewNote: row.reviewNote,
  connections: row.connections.map(connectionView),
});

@Injectable()
export class EnterpriseOnboardingService {
  constructor(private readonly prisma: PrismaService) {}
  activate(actor:CommandActor,id:string,input:ActivateEnterpriseDto) {
    return commandTransaction(this.prisma,async tx=>{
      if(actor.role!=='SYSTEM_ADMIN')throw new ForbiddenException('Chỉ quản trị nền tảng được kích hoạt dịch vụ');
      await lockPlatformAudit(tx);
      const row=await tx.enterpriseEnrollment.findUniqueOrThrow({where:{id},include:INCLUDE});
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`enterprise:${row.organizationId}`},0))`;
      await tx.$queryRaw`SELECT id FROM enterprise_enrollment WHERE id=${id}::uuid FOR UPDATE`;
      if(row.status!=='APPROVED' || row.version!==input.version || row.serviceActivatedAt)throw new ConflictException('Hồ sơ chưa duyệt, đã kích hoạt hoặc phiên bản đã đổi');
      await tx.enterpriseEnrollment.update({where:{id},data:{serviceActivatedAt:new Date(),serviceActivatedBy:actor.sub!,serviceActivationReason:input.reason,version:{increment:1}}});
      await grantEnterpriseBusiness(tx,row);
      await appendPlatformAudit(tx,{actor,action:'ENTERPRISE_SERVICE_ACTIVATED',subjectType:'ENTERPRISE_ENROLLMENT',subjectId:id,organizationId:row.organizationId,reason:input.reason,details:{manual:true,paymentVerified:false,peerVerified:false}});
      return enrollmentView(await tx.enterpriseEnrollment.findUniqueOrThrow({where:{id},include:INCLUDE}));
    });
  }
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
  async find(actor: CommandActor, id: string) {
    if (actor.role !== 'SYSTEM_ADMIN') throw new ForbiddenException();
    const row = await this.prisma.enterpriseEnrollment.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('Không tìm thấy hồ sơ doanh nghiệp');
    return enrollmentView(row);
  }
  review(actor: CommandActor, id: string, input: ReviewEnterpriseDto) {
    return commandTransaction(this.prisma, async (tx) => {
      if (actor.role !== 'SYSTEM_ADMIN') throw new ForbiddenException();
      await lockPlatformAudit(tx);
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
      await appendPlatformAudit(tx, {
        actor: { sub: actor.sub, role: actor.role },
        action:
          input.decision === 'APPROVE'
            ? 'ENROLLMENT_APPROVED'
            : 'ENROLLMENT_REJECTED',
        subjectType: 'ENTERPRISE_ENROLLMENT',
        subjectId: id,
        organizationId: row.organizationId,
        reason: input.note,
        details: {
          version: input.version,
          // Legacy enrollments that need no activation receive their business
          // capabilities and ORG_ADMIN/CREATE_CHAIN grants in this same step.
          businessAuthorityGranted:
            input.decision === 'APPROVE' && !row.activationRequired,
        },
      });
      if (input.decision === 'APPROVE') {
        if (!row.activationRequired) await grantEnterpriseBusiness(tx, row);
      }
      const profile = await tx.enterpriseProfile.findUnique({
        where: { organizationId: row.organizationId },
      });
      if (profile?.contactEmail) {
        const url = new URL(
          '/enterprise/service',
          process.env.ENTERPRISE_WEB_BASE_URL ?? 'http://127.0.0.1:3001',
        );
        await tx.enterpriseMail.create({
          data: {
            enrollmentId: row.id,
            kind: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            recipient: profile.contactEmail,
            subject:
              input.decision === 'APPROVE'
                ? 'AgriTrace — Hồ sơ được duyệt, hoàn thiện dịch vụ'
                : 'AgriTrace — Kết quả xét duyệt hồ sơ',
            text:
              input.decision === 'APPROVE'
                ? `Hồ sơ ${row.organization.name} đã được quản trị phê duyệt. Đăng nhập tài khoản cấp 1 tại ${url.href} để chọn mô hình peer, gói dịch vụ, điền thông tin thanh toán và xem trước hợp đồng. Đây là môi trường local; chưa thu tiền thật. Ghi chú: ${input.note}`
                : `Hồ sơ ${row.organization.name} cần xử lý: ${input.note}. Đăng nhập để xem kết quả. Không cần thanh toán khi hồ sơ chưa được duyệt.`,
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
        include: { serviceOrder: true },
      });
      if (
        enrollment.activationRequired &&
        !enrollment.serviceActivatedAt
      )
        throw new ForbiddenException(
          'Dịch vụ cần được admin kích hoạt trước khi cấu hình peer',
        );
      const hostingMode =
        enrollment.serviceOrder?.hostingMode ?? enrollment.hostingMode;
      const chain = await tx.supplyChain.findUnique({
        where: { id: input.chainId },
      });
      if (chain?.ownerOrganizationId !== actor.organizationId)
        throw new NotFoundException('Không tìm thấy chuỗi thuộc doanh nghiệp');
      const publicConfig = connectionPublicConfig(input, hostingMode);
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
            hostingMode,
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
    return commandTransaction(this.prisma, (tx) => {
      // Accepting a peer connection needs a second administrator once the
      // two-person policy is enforced. Rejecting stays a single-admin action.
      if (input.decision === 'APPROVE' && approvalsMode() === 'ENFORCED')
        throw new ConflictException(APPROVAL_REQUIRED_MESSAGE);
      return reviewConnectionTx(tx, actor, id, input);
    });
  }
}

/** Connection review body shared by the direct command and an approved proposal. */
export async function reviewConnectionTx(
  tx: Prisma.TransactionClient,
  actor: CommandActor,
  id: string,
  input: ReviewEnterpriseDto,
) {
  {
    {
      if (actor.role !== 'SYSTEM_ADMIN') throw new ForbiddenException();
      await lockPlatformAudit(tx);
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
      const connection = await tx.enterpriseConnection.findUniqueOrThrow({
        where: { id },
        include: { enrollment: { select: { organizationId: true } } },
      });
      await appendPlatformAudit(tx, {
        actor: { sub: actor.sub, role: actor.role },
        action:
          input.decision === 'APPROVE'
            ? 'CONNECTION_APPROVED'
            : 'CONNECTION_REJECTED',
        subjectType: 'ENTERPRISE_CONNECTION',
        subjectId: id,
        organizationId: connection.enrollment.organizationId,
        reason: input.note,
        details: { chainId: connection.chainId, version: input.version },
      });
      const { enrollment: _enrollment, ...plain } = connection;
      return connectionView(plain);
    }
  }
}
