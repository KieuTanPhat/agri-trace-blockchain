import LedgerScreen from "@/features/ledger/screens/login/screen";
import { resolveLedgerRouteInput } from "@/lib/ledger/route-input";
export default async function Page(props: Parameters<typeof resolveLedgerRouteInput>[0]) {
  return <LedgerScreen route={await resolveLedgerRouteInput(props)} />;
}
