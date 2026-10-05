export type Catalog = {
  products: {
    id: string;
    productName: string;
    variety?: string;
    defaultUnit?: string;
    status: string;
  }[];
  farms: {
    id: string;
    name: string;
    organizationId: string;
    location?: string;
    status: string;
    organization?: { name: string };
  }[];
  plots: {
    id: string;
    name: string;
    farmId: string;
    area?: string;
    unit?: string;
    status: string;
    farm?: { name: string };
  }[];
};
export const emptyCatalog: Catalog = { products: [], farms: [], plots: [] };
