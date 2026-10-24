import LedgerScreen from "@/features/ledger/screens/admin/statistics/screen";
import{resolveLedgerRouteInput,type LedgerPageInput}from"@/lib/ledger/route-input";
export default async function Page(props:LedgerPageInput){return <LedgerScreen route={await resolveLedgerRouteInput(props)}/>;}
