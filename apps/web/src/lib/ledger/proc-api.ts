import {ledgerRequest} from "./request";
import type {LineageLot} from "./proc-types";
export const procApi={lineage:(id:string)=>ledgerRequest<{lotId:string;upstream:LineageLot[];downstream:LineageLot[]}>("/processing-runs/lineage/"+encodeURIComponent(id))};
