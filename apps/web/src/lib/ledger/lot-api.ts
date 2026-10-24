import type {components} from "../generated/api";
import {ledgerRequest} from "./request";
import type {LedgerCommandContext} from "./command-context";
type S=components["schemas"];
export type InternalLot=S["InternalLotDto"] & {grade?:string|null};
export type LotCommand=InternalLot["allowedCommands"][number];
export type Shipment=S["ShipmentListDto"];
const post=(p:string,v:unknown,c:LedgerCommandContext)=>ledgerRequest(p,{method:"POST",headers:{"Idempotency-Key":c.idempotencyKey},body:JSON.stringify(v)}),lid=(v:string)=>"/lots/"+encodeURIComponent(v),sid=(v:string)=>"/shipments/"+encodeURIComponent(v);
export const opsApi={lots:()=>ledgerRequest<InternalLot[]>("/lots"),lot:(v:string)=>ledgerRequest<InternalLot>(lid(v)),shipments:()=>ledgerRequest<Shipment[]>("/shipments"),organizations:()=>ledgerRequest<S["OrganizationRecordDto"][]>("/organizations"),
createShipment:(v:S["CreateShipmentDto"],c:LedgerCommandContext)=>post("/shipments",v,c),
startShipment:(v:string,b:S["ShipmentTransitionDto"],c:LedgerCommandContext)=>post(sid(v)+"/start",b,c),arriveShipment:(v:string,b:S["ShipmentTransitionDto"],c:LedgerCommandContext)=>post(sid(v)+"/arrive",b,c),receiveShipment:(v:string,b:S["ReceiveShipmentDto"],c:LedgerCommandContext)=>post(sid(v)+"/receive",b,c),rejectShipment:(v:string,b:S["RejectShipmentDto"],c:LedgerCommandContext)=>post(sid(v)+"/reject",b,c),damageShipment:(v:string,b:S["DamageShipmentDto"],c:LedgerCommandContext)=>post(sid(v)+"/damage",b,c),
damage:(v:string,b:S["DamageLotDto"],c:LedgerCommandContext)=>post(lid(v)+"/damage",b,c),markForSale:(v:string,b:S["LotVersionCommandDto"],c:LedgerCommandContext)=>post(lid(v)+"/mark-for-sale",b,c),markSold:(v:string,b:S["LotVersionCommandDto"],c:LedgerCommandContext)=>post(lid(v)+"/mark-sold",b,c),recall:(v:string,b:S["LotReasonCommandDto"],c:LedgerCommandContext)=>post(lid(v)+"/recall",b,c),expire:(v:string,b:S["LotReasonCommandDto"],c:LedgerCommandContext)=>post(lid(v)+"/expire",b,c)};
