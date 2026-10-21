import { UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

/** Optional product references must stay inside the organization that owns the product. */
export async function assertProductRefs(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: { manufacturingSiteId?: string | null; managerUserId?: string | null },
) {
  if (input.manufacturingSiteId && !await tx.enterpriseSite.findFirst({ where: { id: input.manufacturingSiteId, organizationId, status: 'ACTIVE' } }))
    throw new UnprocessableEntityException('Nhà xưởng sản xuất phải là cơ sở đang hoạt động của doanh nghiệp');
  if (input.managerUserId && !await tx.user.findFirst({ where: { id: input.managerUserId, organizationId, accountStatus: 'ACTIVE' } }))
    throw new UnprocessableEntityException('Người quản lí phải là thành viên đang hoạt động của doanh nghiệp');
}

/** Optional production-area references: materials, seeds and the linked
 * facility must belong to the same organization (arrays carry no FK). */
export async function assertFarmRefs(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: { inputMaterialIds?: string[]; seedMaterialIds?: string[]; linkedSiteId?: string | null },
) {
  const inputs = input.inputMaterialIds ?? [];
  const seeds = input.seedMaterialIds ?? [];
  if (inputs.length && await tx.productionMaterial.count({ where: { id: { in: inputs }, organizationId, kind: { not: 'SEED' } } }) !== inputs.length)
    throw new UnprocessableEntityException('Vật tư đầu vào phải là vật tư (không phải giống) của doanh nghiệp');
  if (seeds.length && await tx.productionMaterial.count({ where: { id: { in: seeds }, organizationId, kind: 'SEED' } }) !== seeds.length)
    throw new UnprocessableEntityException('Loại giống phải là giống trong danh mục của doanh nghiệp');
  if (input.linkedSiteId && !await tx.enterpriseSite.findFirst({ where: { id: input.linkedSiteId, organizationId, status: 'ACTIVE' } }))
    throw new UnprocessableEntityException('Nhà xưởng liên kết phải là cơ sở đang hoạt động của doanh nghiệp');
}

/** The member in charge of a facility must be an active member of its organization. */
export async function assertSiteStaff(
  tx: Prisma.TransactionClient,
  organizationId: string,
  staffUserId?: string | null,
) {
  if (staffUserId && !await tx.user.findFirst({ where: { id: staffUserId, organizationId, accountStatus: 'ACTIVE' } }))
    throw new UnprocessableEntityException('Nhân viên phụ trách phải là thành viên đang hoạt động của doanh nghiệp');
}
