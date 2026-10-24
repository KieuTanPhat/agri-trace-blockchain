import {ledgerRequest} from "./request";
import type {LineageLot,ProcessingMaterial,ProcessingRun,UnitConversion} from "./proc-types";
import type {components} from "../generated/api";
import type {LedgerCommandContext} from "./command-context";
type S=components["schemas"];
const root="/processing-runs",id=(v:string)=>encodeURIComponent(v),post=async<T>(p:string,b:unknown,c:LedgerCommandContext)=>(await ledgerRequest<{record:T}>(root+p,{method:"POST",headers:{"Idempotency-Key":c.idempotencyKey},body:JSON.stringify(b)})).record;
export const procApi={
 lineage:(v:string)=>ledgerRequest<{lotId:string;upstream:LineageLot[];downstream:LineageLot[]}>(root+"/lineage/"+id(v)),
 runs:async(status?:string)=>(await ledgerRequest<{items:ProcessingRun[]}>(root+(status?"?status="+id(status):""))).items,
 run:async(v:string)=>(await ledgerRequest<{record:ProcessingRun}>(root+"/"+id(v))).record,
 materials:async()=>(await ledgerRequest<{items:ProcessingMaterial[]}>(root+"/materials")).items,
 conversions:async(productId?:string)=>(await ledgerRequest<{items:UnitConversion[]}>(root+"/unit-conversions"+(productId?"?productId="+id(productId):""))).items,
 create:(v:S["CreateProcessingRunInput"],c:LedgerCommandContext)=>post<ProcessingRun>("",v,c),
 complete:(v:string,b:S["ProcessingVersionInput"],c:LedgerCommandContext)=>post<ProcessingRun>("/"+id(v)+"/complete",b,c),
 cancel:(v:string,b:S["CancelProcessingInput"],c:LedgerCommandContext)=>post<ProcessingRun>("/"+id(v)+"/cancel",b,c),
 createConversion:(v:S["CreateUnitConversionInput"],c:LedgerCommandContext)=>post<UnitConversion>("/unit-conversions",v,c),
 revokeConversion:(v:string,b:S["RevokeUnitConversionInput"],c:LedgerCommandContext)=>post<UnitConversion>("/unit-conversions/"+id(v)+"/revoke",b,c),
};
