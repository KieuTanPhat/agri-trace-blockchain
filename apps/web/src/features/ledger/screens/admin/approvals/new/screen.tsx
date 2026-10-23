"use client";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { useLocale } from "@/components/ledger/locale";
import { useRouter } from "next/navigation";
import { ProposeDialog } from "../screen";
import { Guard } from "@/components/ledger/kit/guard";
import { PageHeader } from "@/components/ledger/kit/page";
import { t } from "@/lib/ledger/i18n";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  const router = useRouter();
  return (
    <LedgerRouteScreen route={route} name="admin-approvals-new">
      <Guard permission="approval.propose">
        <PageHeader title={t("Tạo đề xuất phê duyệt")} />
        <ProposeDialog
          open
          onOpenChange={(o) => {
            if (!o) router.push("/admin/approvals");
          }}
          initialValues={route.searchParams}
        />
      </Guard>
    </LedgerRouteScreen>
  );
}
