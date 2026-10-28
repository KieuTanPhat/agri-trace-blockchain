import Link from "next/link";
import {LedgerPublicShell} from "@/components/ledger/shell/public-shell";
import {PageBody} from "@/components/ledger/kit/page";
import {Button} from "@/components/ledger/ui/button";
export default function NotFound(){return <LedgerPublicShell><PageBody><span className="font-mono text-sm text-ink-2">404</span><h1 className="text-2xl font-semibold">Không tìm thấy trang</h1><p className="text-sm text-ink-2">Kiểm tra lại đường dẫn hoặc quay về trang đầu.</p><Button asChild className="self-start"><Link href="/">Về trang chủ</Link></Button></PageBody></LedgerPublicShell>;}
