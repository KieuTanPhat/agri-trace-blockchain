import type {components} from "../generated/api";
import type {Invoice,Subscription,PlanVersion} from "./platform-api";
type S=components["schemas"];
export type Partner=S["EnterprisePartnerDto"];
export type PartnerSearchItem=S["PartnerSearchItemDto"];
// Baseline Swagger incorrectly represents nullable string properties as object/null.
export type ExternalPartner=Omit<S["ExternalPartnerRecordDto"],"email"|"note"|"phone"|"representative"|"taxCode"> & {email:string|null;note:string|null;phone:string|null;representative:string|null;taxCode:string|null};
export type Billing={paying:boolean;status:S["EnterpriseBillingDto"]["status"];limits:Record<string,number>|null;usage:Record<string,number>;subscription:Subscription|null;invoices:Invoice[];plans:{code:string;name:string;version:PlanVersion}[];simulationEnabled:boolean};
export type MessageList={items:{id:string;subject:string;lastMessageAt:string;preview:string;lastAuthorName:string|null;participants:number;messages:number;unread:boolean}[];counts:{unread:number};canSend:boolean};
export type MessageThread={id:string;subject:string;participants:{userId:string;fullName:string|null}[];messages:{id:string;authorName:string|null;body:string;createdAt:string;mine:boolean}[]};
