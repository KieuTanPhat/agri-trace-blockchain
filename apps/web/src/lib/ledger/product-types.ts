import type {components} from "../generated/api";
export type Product=components["schemas"]["CatalogDto"]["products"][number];
export type Farm=components["schemas"]["CatalogFarmDto"];
export type {Member,Site} from "./workspace-types";
export type ProductInput=components["schemas"]["ProductDto"];
export type ImportPreview={digest:string;count:number;errors:{row:number;messages:string[]}[];canApply:boolean};
