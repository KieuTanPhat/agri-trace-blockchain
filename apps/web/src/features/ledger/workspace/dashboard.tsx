"use client";
import Link from "next/link";
import type { Dashboard as DashboardData } from "@/lib/types";
import { ledgerRequest } from "@/lib/ledger/request";
import { useLedgerQuery } from "@/lib/ledger/data";
import { t } from "@/lib/ledger/i18n";
import { PageHeader, PageBody, StatRow, Stat, Section, Fields, Field, ErrorState, LoadingRows, EmptyState } from "@/components/ledger/kit/page";
export default function Dashboard() {
  const q = useLedgerQuery({ queryKey: ["dashboard"], queryFn: () => ledgerRequest<DashboardData>("/dashboard") });
  const d = q.data;
  return <><PageHeader title={t("Tổng quan")} actions={<Link href="/enterprise">{t("Doanh nghiệp")}</Link>}/><PageBody>{q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()}/> : !d ? <LoadingRows/> : <><StatRow>{d.stats.map(stat => <Stat key={stat.label} label={stat.label} value={stat.value}/>)}</StatRow><Section title={t("Lô gần đây")}>{d.featuredLot ? <><Fields><Field label={t("Mã lô")} mono>{d.featuredLot.lotId}</Field><Field label={t("Trạng thái")}>{d.featuredLot.currentState}</Field></Fields><Link className="block p-5 text-brand" href={`/lots/${d.featuredLot.lotId}`}>{t("Xem chi tiết lô")}</Link></> : <EmptyState title={t("Chưa có lô")}/>}</Section><div className="flex flex-wrap gap-4 text-brand"><Link href="/production-cycles">{t("Sản xuất")}</Link><Link href="/distribution">{t("Giao nhận")}</Link><Link href="/iot-simulator">{t("Mô phỏng IoT")}</Link></div></>}</PageBody></>;
}
