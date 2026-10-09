import { ForbiddenException } from '@nestjs/common';

export const FARM_WRITE_ROLES = ['FARM_STAFF'] as const;
export const TRANSPORT_WRITE_ROLES = ['TRANSPORTER'] as const;
export const RETAIL_WRITE_ROLES = ['RETAILER'] as const;
export const CUSTODY_WRITE_ROLES = ['TRANSPORTER', 'RETAILER'] as const;

// AGT-007/026 forbid Admin and Auditor business writes. No replacement
// inspection/review actor has been approved. An explicit empty allowlist
// denies HTTP writes until that policy is decided; reads remain available.
export const COMPLIANCE_REVIEW_ROLES: readonly string[] = [];

export type BusinessActor = { role: string; organizationId: string | null };

export function assertBusinessActor(
  actor: BusinessActor,
  allowedRoles: readonly string[],
): void {
  if (!allowedRoles.includes(actor.role) || !actor.organizationId) {
    throw new ForbiddenException(
      'Vai trò hoặc tổ chức không được phép ghi nghiệp vụ',
    );
  }
}

export function rejectUnassignedComplianceWrite(): never {
  throw new ForbiddenException(
    'Chưa phê duyệt vai trò ghi inspection hoặc duyệt chứng chỉ (AGT-026)',
  );
}
