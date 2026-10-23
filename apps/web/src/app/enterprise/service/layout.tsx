import {LedgerServiceDraftProvider} from "@/components/ledger/workspace/service-draft";
export default function Layout({children}:{children:React.ReactNode}){return <LedgerServiceDraftProvider>{children}</LedgerServiceDraftProvider>;}
