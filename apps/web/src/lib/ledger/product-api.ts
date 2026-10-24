import {wapi as workspace} from "./workspace-api";
import {ledgerRequest} from "./request";
import type {LedgerCommandContext} from "./command-context";
import type {ProductInput,ImportPreview} from "./product-types";
const post=(path:string,body:unknown,cmd:LedgerCommandContext)=>ledgerRequest<unknown>(path,{method:"POST",headers:{"Idempotency-Key":cmd.idempotencyKey},body:JSON.stringify(body)});
export const wapi={...workspace,
 lots:()=>ledgerRequest<import("../generated/api").components["schemas"]["InternalLotDto"][]>("/lots"),
 createProduct:(input:ProductInput,cmd:LedgerCommandContext)=>post("/catalog/products",input,cmd),
 reviseProduct:(id:string,input:{product:ProductInput;version:number;reason:string;status:"ACTIVE"|"INACTIVE"},cmd:LedgerCommandContext)=>post(`/enterprise-workspace/products/${encodeURIComponent(id)}`,input,cmd),
 completeProduct:(id:string,input:{version:number},cmd:LedgerCommandContext)=>post(`/catalog/products/${encodeURIComponent(id)}/complete`,input,cmd),
 orderProductPhotos:(id:string,input:{order:string[]},cmd:LedgerCommandContext)=>post(`/enterprise-workspace/products/${encodeURIComponent(id)}/photo-order`,input,cmd),
 previewImport:async(input:{rows:Record<string,string|number>[]})=>(await ledgerRequest<{record:ImportPreview}>("/enterprise-workspace/products-import/preview",{method:"POST",body:JSON.stringify(input)})).record,
 applyImport:(input:{rows:Record<string,string|number>[];digest:string},cmd:LedgerCommandContext)=>post("/enterprise-workspace/products-import/apply",input,cmd),
};
