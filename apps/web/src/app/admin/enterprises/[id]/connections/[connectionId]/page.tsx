import LedgerScreen from "@/features/ledger/screens/admin/enterprises/[id]/connections/[connectionId]/screen";
import {
  resolveLedgerRouteInput,
  type LedgerPageInput,
} from "@/lib/ledger/route-input";
export default async function Page(input: LedgerPageInput) {
  return <LedgerScreen route={await resolveLedgerRouteInput(input)} />;
}
