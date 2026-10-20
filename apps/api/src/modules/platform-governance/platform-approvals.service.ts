import { isPlatformAdminRole } from '../auth/role-codes.js';
import { queueAccountCredentials, temporaryCredential } from '../auth/account-credentials.js';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { hash } from 'bcrypt';
import { isEmail, isUUID } from 'class-validator';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { OrganizationType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { lockChainScope } from '../supply-chains/chain-policy.js';
import { SupplyChainsService } from '../supply-chains/supply-chains.service.js';
import type { GrantRoleDto } from '../supply-chains/dto.js';
import {
  reviewCapabilityTx,
  reviewConnectionTx,
} from '../enterprise-onboarding/enterprise-onboarding.service.js';
import {
  publishPlanVersionTx,
  settleInvoiceTx,
} from '../billing/billing-core.js';
import {
  assertSetting,
  blockQrTx,
  changeSettingTx,
} from '../platform-admin/admin-controls.js';
import { UsersService, createPlatformUserTx } from '../users/users.service.js';
import type {
  ApprovalOperation,
  CancelApprovalDto,
  DecideApprovalDto,
  ProposeApprovalDto,
} from './dto.js';
import {
  appendPlatformAudit,
  lockPlatformAudit,
  redactDetails,
} from './platform-audit.js';
import { approvalTtlHours } from './platform-config.js';
import { PlatformMfaService } from './platform-mfa.service.js';

type ApprovalRow = Prisma.PlatformApprovalGetPayload<{
  include: {
    proposer: { select: { id: true; fullName: true; email: true } };
    decider: { select: { id: true; fullName: true; email: true } };
  };
}>;

const WHO = { select: { id: true, fullName: true, email: true } } as const;
const INCLUDE = { proposer: WHO, decider: WHO } as const;

function text(params: Record<string, unknown>, key: string, max = 255) {
  const value = params[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new UnprocessableEntityException(`Tham số ${key} không hợp lệ`);
  return value.trim();
}
function uuid(params: Record<string, unknown>, key: string) {
  const value = params[key];
  if (typeof value !== 'string' || !isUUID(value))
    throw new UnprocessableEntityException(`Tham số ${key} không hợp lệ`);
  return value;
}

export function effectiveStatus(row: { status: string; expiresAt: Date }) {
  return row.status === 'PENDING' && row.expiresAt.getTime() <= Date.now()
    ? 'EXPIRED'
    : row.status;
}

function view(row: ApprovalRow) {
  return {
    id: row.id,
    operation: row.operation,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    organizationId: row.organizationId,
    // Proposal payloads may carry a bcrypt hash; mask credential-like keys.
    payload: redactDetails(row.payload),
    payloadHash: row.payloadHash,
    proposer: row.proposer,
    proposerReason: row.proposerReason,
    status: row.status,
    effectiveStatus: effectiveStatus(row),
    expiresAt: row.expiresAt,
    decidedBy: row.decider,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    version: row.version,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PlatformApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: PlatformMfaService,
    private readonly chains: SupplyChainsService,
    private readonly users: UsersService,
  ) {}

  async list(status?: string) {
    const rows = await this.prisma.platformApproval.findMany({
      where:
        status === 'EXPIRED'
          ? { status: 'PENDING', expiresAt: { lte: new Date() } }
          : status === 'PENDING'
            ? { status: 'PENDING', expiresAt: { gt: new Date() } }
            : status
              ? { status }
              : {},
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(view);
  }

  async get(id: string) {
    const row = await this.prisma.platformApproval.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException('Không tìm thấy đề xuất');
    return view(row);
  }

  /** Validates and normalizes the parameters of one operation. The returned
   * payload is exactly what the approver reviews and what is later executed. */
  private async normalize(
    tx: Prisma.TransactionClient,
    operation: ApprovalOperation,
    params: Record<string, unknown>,
  ) {
    switch (operation) {
      case 'CAPABILITY_GRANT': {
        const organizationId = uuid(params, 'organizationId');
        const code = text(params, 'code', 30);
        if (!Object.hasOwn(OrganizationType, code))
          throw new UnprocessableEntityException('Năng lực không hợp lệ');
        const org = await tx.organization.findUnique({
          where: { id: organizationId },
        });
        if (org?.status !== 'ACTIVE')
          throw new UnprocessableEntityException('Tổ chức không hoạt động');
        const current = await tx.organizationCapability.findFirst({
          where: { organizationId, code: code as never, revokedAt: null },
        });
        if (current) throw new ConflictException('Capability đang có hiệu lực');
        return {
          subjectType: 'ORGANIZATION',
          subjectId: organizationId,
          organizationId,
          payload: { organizationId, code },
        };
      }
      case 'CREATE_CHAIN_GRANT': {
        const organizationId = uuid(params, 'organizationId');
        const userId = uuid(params, 'userId');
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user || user.organizationId !== organizationId)
          throw new UnprocessableEntityException(
            'Người dùng không thuộc tổ chức',
          );
        return {
          subjectType: 'USER',
          subjectId: userId,
          organizationId,
          payload: { organizationId, userId, role: 'CREATE_CHAIN' },
        };
      }
      case 'SYSTEM_ADMIN_CREATE': {
        const roleCode =
          typeof params.roleCode === 'string'
            ? params.roleCode
            : 'SYSTEM_ADMIN';
        if (!isPlatformAdminRole(roleCode))
          throw new UnprocessableEntityException(
            'Vai trò quản trị không hợp lệ',
          );
        const email = text(params, 'email').toLowerCase();
        if (!isEmail(email))
          throw new UnprocessableEntityException('Email không hợp lệ');
        const fullName = text(params, 'fullName');
        if (await tx.user.findFirst({ where: { email } }))
          throw new ConflictException('Email đã tồn tại');
        return {
          subjectType: 'USER_ACCOUNT',
          subjectId: createHash('sha256').update(email).digest('hex'),
          organizationId: null,
          // No password enters the proposal: approval generates and mails one.
          payload: { email, fullName, roleCode },
        };
      }
      case 'ADMIN_PASSWORD_RESET': {
        const userId = uuid(params, 'userId');
        const password = params.temporaryPassword;
        if (
          typeof password !== 'string' ||
          Buffer.byteLength(password, 'utf8') < 12 ||
          Buffer.byteLength(password, 'utf8') > 72
        )
          throw new UnprocessableEntityException(
            'Mật khẩu tạm phải từ 12 đến 72 byte',
          );
        const target = await tx.user.findUnique({
          where: { id: userId },
          include: { role: true },
        });
        if (!target || !isPlatformAdminRole(target.role.code))
          throw new UnprocessableEntityException(
            'Chỉ đặt lại mật khẩu quản trị viên bằng phê duyệt hai bước',
          );
        return {
          subjectType: 'USER',
          subjectId: userId,
          organizationId: null,
          // The plaintext never enters the proposal: only its bcrypt hash.
          payload: { userId, passwordHash: await hash(password, 12) },
        };
      }
      case 'CONNECTION_APPROVE': {
        const connectionId = uuid(params, 'connectionId');
        const version = params.version;
        if (!Number.isInteger(version) || (version as number) < 0)
          throw new UnprocessableEntityException(
            'Tham số version không hợp lệ',
          );
        const note = text(params, 'note', 1000);
        if (note.length < 10)
          throw new UnprocessableEntityException('Ghi chú tối thiểu 10 ký tự');
        const connection = await tx.enterpriseConnection.findUnique({
          where: { id: connectionId },
          include: { enrollment: { select: { organizationId: true } } },
        });
        if (!connection) throw new NotFoundException('Không tìm thấy kết nối');
        if (
          connection.status !== 'PENDING_REVIEW' ||
          connection.version !== version
        )
          throw new ConflictException('Kết nối đã được xử lý hoặc đã thay đổi');
        return {
          subjectType: 'ENTERPRISE_CONNECTION',
          subjectId: connectionId,
          organizationId: connection.enrollment.organizationId,
          payload: { connectionId, version, note },
        };
      }
      case 'CAPABILITY_REQUEST_APPROVE': {
        const requestId = uuid(params, 'requestId');
        const version = params.version;
        if (!Number.isInteger(version) || (version as number) < 0)
          throw new UnprocessableEntityException('Tham số version không hợp lệ');
        const note = text(params, 'note', 1000);
        const request = await tx.capabilityRequest.findUnique({ where: { id: requestId } });
        if (!request || request.status !== 'PENDING' || request.version !== version)
          throw new ConflictException('Yêu cầu năng lực đã được xử lý hoặc đã thay đổi');
        return {
          subjectType: 'CAPABILITY_REQUEST',
          subjectId: requestId,
          organizationId: request.organizationId,
          payload: { requestId, version, note, code: request.code },
        };
      }
      case 'PLAN_VERSION_PUBLISH': {
        const versionId = uuid(params, 'versionId');
        const draft = await tx.servicePlanVersion.findUnique({ where: { id: versionId } });
        if (!draft || draft.status !== 'DRAFT')
          throw new ConflictException('Chỉ công bố phiên bản giá nháp');
        return {
          subjectType: 'SERVICE_PLAN_VERSION',
          subjectId: versionId,
          organizationId: null,
          payload: {
            versionId,
            planCode: draft.planCode,
            version: draft.version,
            setupFee: Number(draft.setupFee),
            annualFee: Number(draft.annualFee),
            limits: draft.limits as Record<string, number>,
          },
        };
      }
      case 'INVOICE_CONFIRM_PAYMENT': {
        const invoiceId = uuid(params, 'invoiceId');
        const version = params.version;
        if (!Number.isInteger(version) || (version as number) < 0)
          throw new UnprocessableEntityException('Tham số version không hợp lệ');
        const reference = text(params, 'reference', 120);
        const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
        if (!invoice || invoice.status !== 'ISSUED' || invoice.version !== version)
          throw new ConflictException('Hóa đơn đã được xử lý hoặc đã thay đổi');
        return {
          subjectType: 'INVOICE',
          subjectId: invoiceId,
          organizationId: invoice.organizationId,
          payload: { invoiceId, version, reference, number: invoice.number, amount: Number(invoice.amount) },
        };
      }
      case 'SETTING_CHANGE': {
        const key = text(params, 'key', 80);
        const version = params.version;
        if (!Number.isInteger(version) || (version as number) < 0)
          throw new UnprocessableEntityException('Tham số version không hợp lệ');
        assertSetting(key, params.value);
        const setting = await tx.platformSetting.findUnique({ where: { key } });
        if (!setting || setting.version !== version)
          throw new ConflictException('Tham số đã thay đổi; tải lại');
        return {
          subjectType: 'PLATFORM_SETTING',
          subjectId: createHash('sha256').update(key).digest('hex'),
          organizationId: null,
          payload: { key, value: params.value as string | number, version, before: setting.value as string | number },
        };
      }
      case 'QR_BLOCK': {
        const lotId = uuid(params, 'lotId');
        const publicMessage = text(params, 'publicMessage', 500);
        const lot = await tx.lot.findUnique({ where: { id: lotId }, include: { traceQr: true } });
        if (!lot?.traceQr) throw new NotFoundException('Lô chưa có mã QR');
        if (await tx.traceQrBlock.findFirst({ where: { lotId, unblockedAt: null } }))
          throw new ConflictException('Mã QR đang bị khóa');
        return {
          subjectType: 'LOT',
          subjectId: lotId,
          organizationId: lot.farmOrgId,
          payload: { lotId, publicMessage, lotCode: lot.lotCode },
        };
      }
    }
  }

  /** Marks overdue pending proposals for the same subject EXPIRED (a system
   * transition), so an abandoned proposal cannot block its subject forever. */
  private async expireOverdue(
    tx: Prisma.TransactionClient,
    operation: string,
    subjectId: string,
  ) {
    const overdue = await tx.platformApproval.findMany({
      where: {
        operation,
        subjectId,
        status: 'PENDING',
        expiresAt: { lte: new Date() },
      },
    });
    for (const row of overdue) {
      const changed = await tx.platformApproval.updateMany({
        where: { id: row.id, version: row.version, status: 'PENDING' },
        data: {
          status: 'EXPIRED',
          decidedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (changed.count === 1)
        await appendPlatformAudit(tx, {
          actor: null,
          action: 'APPROVAL_EXPIRED',
          subjectType: 'PLATFORM_APPROVAL',
          subjectId: row.id,
          organizationId: row.organizationId,
          details: { operation, expiresAt: row.expiresAt.toISOString() },
        });
    }
  }

  propose(
    actor: CommandActor,
    input: ProposeApprovalDto,
    mfaCode: string | undefined,
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      await lockPlatformAudit(tx);
      await this.mfa.assertStepUp(
        tx,
        { sub: actor.sub!, role: actor.role },
        mfaCode,
      );
      const normalized = await this.normalize(
        tx,
        input.operation,
        input.params,
      );
      await this.expireOverdue(tx, input.operation, normalized.subjectId);
      const created = await tx.platformApproval.create({
        data: {
          operation: input.operation,
          subjectType: normalized.subjectType,
          subjectId: normalized.subjectId,
          organizationId: normalized.organizationId,
          payload: normalized.payload as Prisma.InputJsonObject,
          payloadHash: canonicalSha256(normalized.payload),
          proposerId: actor.sub!,
          proposerReason: input.reason,
          expiresAt: new Date(Date.now() + approvalTtlHours() * 3_600_000),
        },
        include: INCLUDE,
      });
      await appendPlatformAudit(tx, {
        actor: { sub: actor.sub, role: actor.role },
        action: 'APPROVAL_PROPOSED',
        subjectType: 'PLATFORM_APPROVAL',
        subjectId: created.id,
        organizationId: normalized.organizationId,
        reason: input.reason,
        details: {
          operation: input.operation,
          targetType: normalized.subjectType,
          targetId: normalized.subjectId,
          payloadHash: created.payloadHash,
          expiresAt: created.expiresAt.toISOString(),
        },
      });
      return view(created);
    });
  }

  decide(
    actor: CommandActor,
    id: string,
    input: DecideApprovalDto,
    mfaCode: string | undefined,
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      await lockPlatformAudit(tx);
      await tx.$queryRaw`SELECT platform_approval_id FROM platform_approval WHERE platform_approval_id = ${id}::uuid FOR UPDATE`;
      const row = await tx.platformApproval.findUnique({
        where: { id },
        include: { proposer: { select: { accountStatus: true } } },
      });
      if (!row) throw new NotFoundException('Không tìm thấy đề xuất');
      if (row.proposerId === actor.sub)
        throw new ForbiddenException('Người phê duyệt phải khác người đề xuất');
      if (row.proposer.accountStatus !== 'ACTIVE')
        throw new ConflictException(
          'Người đề xuất không còn hoạt động; hủy đề xuất này',
        );
      if (row.status !== 'PENDING' || row.version !== input.version)
        throw new ConflictException(
          'Đề xuất đã được xử lý; tải lại trạng thái',
        );
      if (row.expiresAt.getTime() <= Date.now())
        throw new ConflictException('Đề xuất đã hết hạn');
      if (input.decision === 'APPROVE')
        await this.mfa.assertStepUp(
          tx,
          { sub: actor.sub!, role: actor.role },
          mfaCode,
        );
      let result: Prisma.InputJsonValue = { executed: false };
      if (input.decision === 'APPROVE') {
        // Proposal integrity: what is executed is exactly what was hashed.
        if (canonicalSha256(row.payload) !== row.payloadHash)
          throw new ConflictException('Nội dung đề xuất không toàn vẹn');
        result = (await this.execute(tx, actor, row)) as Prisma.InputJsonValue;
      }
      const changed = await tx.platformApproval.updateMany({
        where: { id, version: input.version, status: 'PENDING' },
        data: {
          status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          decidedBy: actor.sub,
          decidedAt: new Date(),
          decisionNote: input.note,
          result,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'Đề xuất đã được xử lý; tải lại trạng thái',
        );
      await appendPlatformAudit(tx, {
        actor: { sub: actor.sub, role: actor.role },
        action:
          input.decision === 'APPROVE'
            ? 'APPROVAL_APPROVED'
            : 'APPROVAL_REJECTED',
        subjectType: 'PLATFORM_APPROVAL',
        subjectId: id,
        organizationId: row.organizationId,
        reason: input.note,
        details: {
          operation: row.operation,
          proposerId: row.proposerId,
          payloadHash: row.payloadHash,
        },
      });
      return view(
        await tx.platformApproval.findUniqueOrThrow({
          where: { id },
          include: INCLUDE,
        }),
      );
    });
  }

  cancel(actor: CommandActor, id: string, input: CancelApprovalDto) {
    return commandTransaction(this.prisma, async (tx) => {
      await lockPlatformAudit(tx);
      await tx.$queryRaw`SELECT platform_approval_id FROM platform_approval WHERE platform_approval_id = ${id}::uuid FOR UPDATE`;
      const row = await tx.platformApproval.findUnique({
        where: { id },
        include: { proposer: { select: { accountStatus: true } } },
      });
      if (!row) throw new NotFoundException('Không tìm thấy đề xuất');
      // The proposer withdraws their own proposal; any administrator may clear
      // one that expired or whose proposer can no longer act.
      if (
        row.proposerId !== actor.sub &&
        row.expiresAt.getTime() > Date.now() &&
        row.proposer.accountStatus === 'ACTIVE'
      )
        throw new ForbiddenException('Chỉ người đề xuất được hủy đề xuất');
      if (row.status !== 'PENDING' || row.version !== input.version)
        throw new ConflictException(
          'Đề xuất đã được xử lý; tải lại trạng thái',
        );
      const changed = await tx.platformApproval.updateMany({
        where: { id, version: input.version, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          decidedBy: actor.sub,
          decidedAt: new Date(),
          decisionNote: input.note,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'Đề xuất đã được xử lý; tải lại trạng thái',
        );
      await appendPlatformAudit(tx, {
        actor: { sub: actor.sub, role: actor.role },
        action: 'APPROVAL_CANCELLED',
        subjectType: 'PLATFORM_APPROVAL',
        subjectId: id,
        organizationId: row.organizationId,
        reason: input.note,
        details: { operation: row.operation },
      });
      return view(
        await tx.platformApproval.findUniqueOrThrow({
          where: { id },
          include: INCLUDE,
        }),
      );
    });
  }

  /** Runs the approved action on the decision transaction, so the domain write,
   * the approval state and the audit entries commit or roll back together. */
  private async execute(
    tx: Prisma.TransactionClient,
    actor: CommandActor,
    row: {
      operation: string;
      payload: Prisma.JsonValue;
      organizationId: string | null;
      proposerReason: string;
    },
  ): Promise<Record<string, unknown>> {
    const p = row.payload as Record<string, string | number>;
    switch (row.operation) {
      case 'CAPABILITY_GRANT': {
        const orgId = String(p.organizationId);
        await tx.$queryRaw`SELECT organization_id FROM organization WHERE organization_id = ${orgId}::uuid FOR SHARE`;
        await lockChainScope(tx, `org:${orgId}`);
        const capability = await this.chains.capabilityTx(
          tx,
          actor,
          orgId,
          String(p.code) as keyof typeof OrganizationType,
        );
        return { executed: true, capabilityRevision: capability.revision };
      }
      case 'CREATE_CHAIN_GRANT': {
        const orgId = String(p.organizationId);
        const userId = String(p.userId);
        await tx.$queryRaw`SELECT organization_id FROM organization WHERE organization_id = ${orgId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT user_id FROM app_user WHERE user_id = ${userId}::uuid FOR SHARE`;
        await lockChainScope(tx, `org:${orgId}`);
        const grant = await this.chains.grantTx(tx, actor, orgId, {
          userId,
          role: 'CREATE_CHAIN',
        } as GrantRoleDto);
        return { executed: true, grantId: grant.id };
      }
      case 'SYSTEM_ADMIN_CREATE': {
        // Older proposals carry a proposer-chosen hash; new ones get a
        // generated password mailed to the account.
        const fresh =
          typeof p.passwordHash === 'string' ? null : await temporaryCredential();
        const created = await createPlatformUserTx(tx, actor, {
          email: String(p.email),
          fullName: String(p.fullName),
          passwordHash: fresh?.passwordHash ?? String(p.passwordHash),
          roleCode:
            typeof p.roleCode === 'string' ? p.roleCode : 'SYSTEM_ADMIN',
          mustChangePassword: true,
        });
        if (fresh)
          await queueAccountCredentials(
            tx,
            created,
            fresh.password,
            'Tài khoản quản trị AgriTrace của bạn đã được phê duyệt.',
          );
        return { executed: true, userId: created.id };
      }
      case 'ADMIN_PASSWORD_RESET': {
        const reset = await this.users.resetPasswordTx(
          tx,
          actor,
          String(p.userId),
          String(p.passwordHash),
          row.proposerReason,
        );
        return { executed: true, userId: reset.id };
      }
      case 'CONNECTION_APPROVE': {
        const connection = await reviewConnectionTx(
          tx,
          actor,
          String(p.connectionId),
          {
            version: Number(p.version),
            decision: 'APPROVE',
            note: String(p.note),
          },
        );
        return { executed: true, connectionId: connection.id };
      }
      case 'CAPABILITY_REQUEST_APPROVE': {
        const request = await reviewCapabilityTx(tx, actor, String(p.requestId), {
          version: Number(p.version),
          decision: 'APPROVE',
          note: String(p.note),
        });
        return { executed: true, requestId: request.id, status: request.status };
      }
      case 'PLAN_VERSION_PUBLISH': {
        const published = await publishPlanVersionTx(tx, actor, String(p.versionId), row.proposerReason);
        return { executed: true, versionId: published.id };
      }
      case 'INVOICE_CONFIRM_PAYMENT': {
        const invoice = await settleInvoiceTx(tx, actor, String(p.invoiceId), {
          provider: 'MANUAL',
          version: Number(p.version),
          reference: String(p.reference),
          note: row.proposerReason,
        });
        return { executed: true, invoiceId: invoice.id };
      }
      case 'SETTING_CHANGE': {
        const raw = row.payload as Record<string, unknown>;
        const setting = await changeSettingTx(tx, actor, {
          key: String(raw.key),
          value: raw.value,
          version: Number(raw.version),
          reason: row.proposerReason,
        });
        return { executed: true, key: setting.key, version: setting.version };
      }
      case 'QR_BLOCK': {
        const block = await blockQrTx(tx, actor, {
          lotId: String(p.lotId),
          publicMessage: String(p.publicMessage),
          reason: row.proposerReason,
        });
        return { executed: true, blockId: block.id };
      }
      default:
        throw new ConflictException('Loại đề xuất không được hỗ trợ');
    }
  }
}
