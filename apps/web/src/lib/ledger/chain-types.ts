import {z} from "zod";
import type {components} from "../generated/api";
type S=components["schemas"];
export const CHAIN_TYPES=["CROP","LIVESTOCK","AQUACULTURE","PROCESSED_FOOD"] as const;
export const SUPPLY_STAGES=["FARM","PROCESSOR","TRANSPORTER","DISTRIBUTOR","RETAILER"] as const;
export const SCOPED_ROLES=["ORG_ADMIN","CREATE_CHAIN","CHAIN_MANAGER","FARM_STAFF","TRANSPORTER","PROCESSOR","DISTRIBUTOR","RETAILER","AUDITOR","COMPLIANCE_REVIEWER"] as const;
export const CHAIN_ROLES=["FARM_STAFF","TRANSPORTER","PROCESSOR","DISTRIBUTOR","RETAILER"] as const;
export type GrantRecord=S["GrantRecordDto"];
export type MemberRecord=S["MemberRecordDto"];
export type SigningKey=S["SigningKeyDto"];
export type PlanParty=S["AcceptShipmentPlanDto"]["party"];
export type ShipmentPlan=S["ShipmentPlanRecordDto"];
const model=z.object({stages:z.array(z.object({stage:z.enum(SUPPLY_STAGES),organizationIds:z.array(z.string())}))});
export type SupplyChain=Omit<S["ChainRecordDto"],"supplyModel"> & {supplyModel:z.infer<typeof model>|null};
export function chainView(row:S["ChainRecordDto"]):SupplyChain{return {...row,supplyModel:row.supplyModel?model.parse(row.supplyModel):null};}
