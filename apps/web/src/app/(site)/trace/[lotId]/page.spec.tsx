import {cleanup,render} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {PublicTraceContent} from "@/features/ledger/public/trace";
import {mockLots,mockPublicTrace} from "@/test/domain-fixtures";
import type {ProofStatus} from "@/lib/types";
vi.mock("next/image",()=>({default:({alt}:{alt:string})=><span role="img" aria-label={alt}/>}));
vi.mock("@/features/ledger/public/report",()=>({ConsumerReport:()=>null}));
afterEach(cleanup);
// Shoppers see a plain warning only when the lot needs re-checking; the ledger state itself is not a card.
it.each<ProofStatus>(["VERIFIED","PENDING","INTEGRITY_WARNING","BLOCKCHAIN_UNAVAILABLE"])("shows the integrity warning only when needed for %s",(proofStatus)=>{const lot=mockPublicTrace(mockLots[0].lotId)!;const {container}=render(<PublicTraceContent lot={{...lot,proofStatus,quantityReconciled:true,stateReconciled:true}}/>);expect(container.textContent?.includes("Thông tin lô đang được kiểm tra lại")).toBe(proofStatus==="INTEGRITY_WARNING");expect(container.textContent).not.toMatch(/sổ cái/i);});
