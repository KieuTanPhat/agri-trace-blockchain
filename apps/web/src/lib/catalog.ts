export type Catalog = {
  products: {
    id: string;
    productName: string;
    variety: string | null;
    defaultUnit: string | null;
    status: string;
  }[];
  farms: {
    id: string;
    name: string;
    organizationId: string;
    location: string | null;
    status: string;
    organization?: { name: string };
  }[];
  plots: {
    id: string;
    name: string;
    farmId: string;
    area: string | null;
    unit: string | null;
    location: string | null;
    status: string;
    farm?: { name: string };
  }[];
};
export const emptyCatalog: Catalog = { products: [], farms: [], plots: [] };
