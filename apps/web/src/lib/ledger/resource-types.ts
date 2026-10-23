import type {components} from "../generated/api";
import {localized} from "./i18n";
type S=components["schemas"];
export type Farm=S["CatalogFarmDto"];
export type Plot=S["CatalogPlotDto"];
export type Material=S["ProductionMaterialRecordDto"];
export type Vehicle=S["EnterpriseVehicleRecordDto"];
export type {Site} from "./workspace-types";
export const SITE_KIND_LABEL:Record<string,string>=localized({PRODUCTION:"Sản xuất",PACKING:"Đóng gói",WAREHOUSE:"Kho",COLD_STORAGE:"Kho lạnh",PROCESSING:"Chế biến",DISTRIBUTION:"Phân phối",RETAIL:"Bán lẻ",OTHER:"Khác"});
