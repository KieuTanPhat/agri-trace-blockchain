import {cleanup,render} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {PublicTraceContent} from "@/features/ledger/public/trace";
import {mockLots,mockPublicTrace} from "@/test/domain-fixtures";
import type {ProofStatus} from "@/lib/types";
vi.mock("next/image",()=>({default:({alt}:{alt:string})=><span role="img" aria-label={alt}/>}));
vi.mock("@/features/ledger/public/report",()=>({ConsumerReport:()=>null}));
afterEach(cleanup);
it.each<[ProofStatus,string]>([["VERIFIED","Đã xác nhận trên sổ cái"],["PENDING","Đang chờ xác nhận sổ cái"],["INTEGRITY_WARNING","Cảnh báo tính toàn vẹn"],["BLOCKCHAIN_UNAVAILABLE","Sổ cái chưa khả dụng"]])("preserves the public proof state for %s",(proofStatus,label)=>{const lot=mockPublicTrace(mockLots[0].lotId)!;const {getAllByText}=render(<PublicTraceContent lot={{...lot,proofStatus}}/>);expect(getAllByText(label).length).toBeGreaterThan(0);});
