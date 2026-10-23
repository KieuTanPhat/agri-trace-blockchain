import type {components} from "../generated/api";
type S=components["schemas"];
export type Cycle=S["CycleDetailDto"] & {name?:string|null;cultivatedArea?:string|null;plantedAt?:string|null};
export type CycleList=S["CycleListDto"] & {name?:string|null};
export type CycleDraft=Omit<S["ProductionCycleDraftRecordDto"],"cultivationMethod"|"maxHarvestQuantity"|"note"|"responsibleUserId"|"seedMaterialId"> & {cultivationMethod:string|null;maxHarvestQuantity:string|null;note:string|null;responsibleUserId:string|null;seedMaterialId:string|null};
export function additionalEvidence(ids:string[]):NonNullable<S["RecordHarvestDto"]["additionalEvidenceRefs"]>{
 if(ids.length>4)throw new Error("Chỉ chọn tối đa bốn ảnh bổ sung");
 const [a,b,c,d]=ids;return a===undefined?[]:b===undefined?[a]:c===undefined?[a,b]:d===undefined?[a,b,c]:[a,b,c,d];
}
