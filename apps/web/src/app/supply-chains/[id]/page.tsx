import Screen from "@/features/ledger/screens/supply-chains/[id]/screen";
import {resolveLedgerRouteInput,type LedgerPageInput} from "@/lib/ledger/route-input";
export default async function Page(props:LedgerPageInput){return <Screen route={await resolveLedgerRouteInput(props)}/>;}
