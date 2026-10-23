import type {components} from "../generated/api";
type Certificate=components["schemas"]["CertificateRecordDto"];
// Baseline ancestry rule: incomplete/cyclic ancestry cannot establish independent review.
export function selfReview(item:Certificate,certificates:Certificate[],userId:string|undefined){const seen=new Set<string>();let current:Certificate|undefined=item;while(current){if(seen.has(current.id)||current.submittedByUserId===userId)return true;seen.add(current.id);if(!current.supersedesId)return false;current=certificates.find(ancestor=>ancestor.id===current!.supersedesId);if(!current)return true;}return true;}
