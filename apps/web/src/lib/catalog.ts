import type { components } from "../shared/api/generated/api";
export type Catalog = components["schemas"]["CatalogDto"];
export const emptyCatalog: Catalog = { products: [], farms: [], plots: [] };
