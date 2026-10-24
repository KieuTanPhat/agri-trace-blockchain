"use client";

import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import { t as tr } from "@/lib/ledger/i18n";
import { CAPABILITY_LABEL } from "@/lib/ledger/labels";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ledger/ui/dialog";
import { ErrorState, LoadingRows } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";

/** Hồ sơ công khai của doanh nghiệp trong danh bạ (GET /enterprise-workspace/partners/directory/:organizationId). */
export function PartnerProfileDialog({ organizationId, onClose }: { organizationId: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["ws-partner-profile", organizationId], queryFn: () => wapi.partnerProfile(organizationId!), enabled: !!organizationId, retry: false });
  const d = q.data;
  return (
    <Dialog open={!!organizationId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{d?.name ?? tr("Hồ sơ doanh nghiệp")}</DialogTitle>
          <DialogDescription>{d ? <span className="font-mono text-[11.5px]">{d.agriTraceCode}</span> : tr("Đang tải…")}</DialogDescription>
        </DialogHeader>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !d ? (
          <LoadingRows rows={4} />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {d.capabilities.map((c) => (
                <Badge key={c} tone="neutral" dot={false}>{CAPABILITY_LABEL[c] ?? c}</Badge>
              ))}
              {d.linkStatus && <Badge tone={d.linkStatus === "ACTIVE" ? "ok" : "info"}>{d.linkDirection === "SENT" ? tr("Mình mời") : tr("Được mời")} · {d.linkStatus}</Badge>}
            </div>
            <dl className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
              {[
                [tr("Mã số thuế"), d.taxCode && <span key="tax-code" className="font-mono">{d.taxCode}</span>],
                [tr("Người đại diện"), d.representative],
                [tr("Địa chỉ"), [d.address, d.ward, d.province].filter(Boolean).join(", ")],
                [tr("Điện thoại"), d.phone],
                [tr("Email liên hệ"), d.contactEmail],
                ["Website", d.website],
                [tr("Giới thiệu"), d.description],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k as string} className="contents">
                    <dt className="text-ink-2">{k}</dt>
                    <dd className="min-w-0 break-words">{v}</dd>
                  </div>
                ))}
            </dl>
            <p className="text-[11.5px] text-ink-2">{tr("Chỉ hiển thị doanh nghiệp đã được duyệt và có thể mời liên kết.")}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
