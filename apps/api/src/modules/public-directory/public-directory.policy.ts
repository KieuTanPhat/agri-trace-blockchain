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
        OR: [
          {
            originType: 'HARVEST',
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
          {
            originType: 'TRANSFORMATION',
            processingRun: { is: { status: 'COMPLETED' } },
          },
        ],
      },
      extra,
    ],
  };
}
export function relatedLotWhere(organizationId: string): Prisma.LotWhereInput {
  return {
    OR: [
      { distributionLines: { some: { transfer: {
        status: { not: 'CANCELLED' },
        OR: [{ senderId: organizationId }, { carrierId: organizationId }, { receiverId: organizationId }],
      } } } },
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
  distributedOrgIds: string[] = [],
): Prisma.OrganizationWhereInput {
  return {
    status: 'ACTIVE',
    OR: [
      { id: { in: distributedOrgIds } },
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
  category:true, price:true, gtin:true, storageConditions:true, ingredients:true, usageInstructions:true,
  organizationId:true,createdAt:true,
  organization:{select:{directoryPublications:{take:1,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{presentation:true}}}},
  lots:{where:publicLotWhere(),take:50,orderBy:{createdAt:'desc'},select:{id:true}},
  _count:{select:{lots:{where:publicLotWhere()}}},
} satisfies Prisma.ProductSelect;
export const PUBLIC_ENTERPRISE_SELECT = {
  id: true,
  name: true,
  type: true,
  directoryPublications:{take:1,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{presentation:true}},
} satisfies Prisma.OrganizationSelect;
export const PUBLIC_CERTIFICATE_SELECT = {
  id: true,
  type: true,
  issuer: true,
  issueDate: true,
  expiryDate: true,
  documentHash: true,
} satisfies Prisma.CertificateSelect;
