import {cleanup,render} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {PublicTraceContent} from "@/features/ledger/public/trace";
import {mockLots,mockPublicTrace} from "@/test/domain-fixtures";
import type {ProofStatus} from "@/lib/types";
vi.mock("next/image",()=>({default:({alt}:{alt:string})=><span role="img" aria-label={alt}/>}));
vi.mock("@/features/ledger/public/report",()=>({ConsumerReport:()=>null}));
afterEach(cleanup);
it.each<[ProofStatus,string]>([["VERIFIED","Đã xác nhận trên sổ cái"],["PENDING","Đang chờ xác nhận sổ cái"],["INTEGRITY_WARNING","Cảnh báo tính toàn vẹn"],["BLOCKCHAIN_UNAVAILABLE","Sổ cái chưa khả dụng"]])("preserves the public proof state for %s",(proofStatus,label)=>{const lot=mockPublicTrace(mockLots[0].lotId)!;const {getAllByText}=render(<PublicTraceContent lot={{...lot,proofStatus}}/>);expect(getAllByText(label).length).toBeGreaterThan(0);});

it("places recall and expiry before verified proof",()=>{
  const lot=mockPublicTrace(mockLots[0].lotId)!;
  const {getByText,getAllByText}=render(<PublicTraceContent lot={{...lot,proofStatus:"VERIFIED",isExpired:true,notices:[{kind:"RECALL",message:"Dừng sử dụng",createdAt:"2026-10-01T00:00:00Z"}]}}/>);
  const proof=getAllByText("Đã xác nhận trên sổ cái")[0];
  for(const warning of [getByText("Lô đã hết hạn sử dụng"),getByText("Dừng sử dụng")]){
    expect(warning.compareDocumentPosition(proof)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
});
