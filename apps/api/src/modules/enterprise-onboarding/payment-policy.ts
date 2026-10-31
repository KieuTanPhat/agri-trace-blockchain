import { ConflictException } from '@nestjs/common';
import type {
  CapabilityRequest,
  Prisma,
} from '../../generated/prisma/client.js';
import { payingParticipant } from './registration-profile.dto.js';

/** Collection is deferred unless an operator explicitly enables the billing flow.
 * This never changes invoices, payment history, capabilities or chain authority. */
export const enterprisePaymentsEnabled = () =>
  process.env.ENTERPRISE_PAYMENTS_ENABLED === 'true';

export function assertEnterprisePaymentsEnabled() {
  if (!enterprisePaymentsEnabled())
    throw new ConflictException(
      'Thanh toán đang tạm hoãn; không cần mua gói để được quản trị kích hoạt sử dụng tạm',
    );
}

export async function assertActivationReady(
  tx: Prisma.TransactionClient,
  row: {
    organizationId: string;
    organization: {
      participationModel?: string;
      capabilityRequests?: Pick<CapabilityRequest, 'status' | 'code'>[];
    };
  },
) {
  const requests = row.organization.capabilityRequests ?? [];
  if (requests.some((r) => r.status === 'PENDING'))
    throw new ConflictException('Còn năng lực chưa được xét duyệt');
  const approved = requests.filter((r) => r.status === 'APPROVED');
  if (requests.length && !approved.length)
    throw new ConflictException('Chưa có năng lực nào được phê duyệt');
  if (
    !enterprisePaymentsEnabled() ||
    !requests.length ||
    !payingParticipant(
      row.organization.participationModel ?? 'SINGLE',
      approved.map((r) => r.code),
    )
  )
    return;
  const subscription = await tx.subscription.findFirst({
    where: { organizationId: row.organizationId, status: 'ACTIVE' },
  });
  if (!subscription)
    throw new ConflictException(
      'Tổ chức trả phí cần thanh toán gói dịch vụ trước khi kích hoạt',
    );
}

export function serviceWorkspaceStage(base: string) {
  if (enterprisePaymentsEnabled()) return base;
  if (base === 'ACTIVE') return 'TEMPORARY_ACCESS';
  if (base === 'AWAITING_ACTIVATION') return 'AWAITING_TEMPORARY_ACTIVATION';
  return base;
}
