import { Prisma } from '../../generated/prisma/client.js';

// Spell out the existing fields so future schema additions do not silently
// expand this API. No fields from the pre-refactor response are removed.
export const PRODUCT_SELECT = {
  id: true,
  productName: true,
  variety: true,
  defaultUnit: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

const ORGANIZATION_SELECT = {
  id: true,
  name: true,
  type: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

const FARM_FIELDS = {
  id: true,
  organizationId: true,
  name: true,
  location: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FarmSelect;

export const FARM_SELECT = {
  ...FARM_FIELDS,
  organization: { select: ORGANIZATION_SELECT },
} satisfies Prisma.FarmSelect;

export const PLOT_SELECT = {
  id: true,
  farmId: true,
  name: true,
  area: true,
  unit: true,
  location: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  farm: { select: FARM_FIELDS },
} satisfies Prisma.PlotSelect;

export interface CatalogResponse {
  products: Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>[];
  farms: Prisma.FarmGetPayload<{ select: typeof FARM_SELECT }>[];
  plots: Prisma.PlotGetPayload<{ select: typeof PLOT_SELECT }>[];
}
