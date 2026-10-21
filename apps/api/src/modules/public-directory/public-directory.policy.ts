import type { Prisma } from '../../generated/prisma/client.js';

// QR possession does not certify quality. Expired/recalled Lots stay visible;
// their trace endpoint retains its safety and integrity warnings.
export function publicLotWhere(
  extra: Prisma.LotWhereInput = {},
): Prisma.LotWhereInput {
  return {
    AND: [
      { traceQr: { isNot: null } },
      { product: { is: { status: 'ACTIVE' } } },
      { organization: { is: { status: 'ACTIVE' } } },
      {
        harvest: {
          is: {
            cycle: {
              is: {
                farm: {
                  is: {
                    status: 'ACTIVE',
                    organization: { is: { status: 'ACTIVE' } },
                  },
                },
              },
            },
          },
        },
      },
      extra,
    ],
  };
}
export function relatedLotWhere(organizationId: string): Prisma.LotWhereInput {
  return {
    OR: [
      { farmOrgId: organizationId },
      {
        shipment: {
          is: {
            OR: [
              { transporterOrgId: organizationId },
              { retailerOrgId: organizationId },
            ],
          },
        },
      },
    ],
  };
}
export function relatedEnterpriseWhere(
  lots: Prisma.LotWhereInput,
): Prisma.OrganizationWhereInput {
  return {
    status: 'ACTIVE',
    OR: [
      { lots: { some: lots } },
      { shipmentsAsTransporter: { some: { lot: { is: lots } } } },
      { shipmentsAsRetailer: { some: { lot: { is: lots } } } },
    ],
  };
}
export const PUBLIC_PRODUCT_SELECT = {
  id: true,
  productName: true,
  variety: true,
  defaultUnit: true,
  description: true,
} satisfies Prisma.ProductSelect;
export const PUBLIC_ENTERPRISE_SELECT = {
  id: true,
  name: true,
  type: true,
} satisfies Prisma.OrganizationSelect;
export const PUBLIC_CERTIFICATE_SELECT = {
  id: true,
  type: true,
  issuer: true,
  issueDate: true,
  expiryDate: true,
  documentHash: true,
} satisfies Prisma.CertificateSelect;
