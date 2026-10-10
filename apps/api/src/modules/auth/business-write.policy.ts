import { ForbiddenException } from '@nestjs/common';

export const FARM_WRITE_ROLES = ['FARM_STAFF'] as const;
export const TRANSPORT_WRITE_ROLES = ['TRANSPORTER'] as const;
export const RETAIL_WRITE_ROLES = ['RETAILER'] as const;
export const CUSTODY_WRITE_ROLES = ['TRANSPORTER', 'RETAILER'] as const;

// Admin manages assignments; only the assigned reviewer writes compliance.
export const COMPLIANCE_REVIEW_ROLES = ['COMPLIANCE_REVIEWER'] as const;

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
