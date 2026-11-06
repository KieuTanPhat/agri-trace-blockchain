"use client";
import Link from "next/link";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { wapi } from "@/lib/ledger/workspace-api";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { canUseEnterpriseRoute } from "@/lib/enterprise-access";
import { t as tr } from "@/lib/ledger/i18n";
import { Section } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";

type Desk = { capability: string; title: string; hint: string; links: Array<[string, string]> };
/** Common shell, one desk per capability: the traceability work of that role
 * (receive, move, hand over, sell, recall), never ERP orders or prices. */
const DESKS: Desk[] = [
  { capability: "FARM", title: "Sản xuất", hint: "Vụ, nhật ký, thu hoạch tạo lô trong sổ ghi hoặc chuỗi được mời.", links: [["/production-cycles", "Vụ sản xuất"], ["/enterprise/areas", "Vùng trồng"], ["/enterprise/materials", "Vật tư"]] },
  { capability: "PROCESSOR", title: "Chế biến", hint: "Phiếu nhập, lệnh chế biến hoặc đóng gói, lô thành phẩm.", links: [["/enterprise/inbound", "Hàng chờ nhận"], ["/enterprise/processing", "Lệnh chế biến"]] },
  { capability: "TRANSPORTER", title: "Vận chuyển", hint: "Nhận yêu cầu lấy hàng, chở và bàn giao, ghi hư hỏng trên đường.", links: [["/distribution", "Chuyến và bàn giao"], ["/enterprise/vehicles", "Phương tiện"]] },
  { capability: "DISTRIBUTOR", title: "Kho / phân phối", hint: "Nhận hàng, phân kho, cách ly, xuất giao, trả hàng, xuất ra ngoài hệ thống.", links: [["/enterprise/inbound", "Hàng chờ nhận"], ["/distribution", "Giao nhận"], ["/enterprise/inventory", "Tồn kho theo lô"], ["/enterprise/reports", "Cân đối khối lượng"]] },
  { capability: "RETAILER", title: "Bán lẻ", hint: "Nhận hàng, bán cho người tiêu dùng, hủy hàng hết hạn, rút hàng thu hồi.", links: [["/enterprise/inbound", "Hàng chờ nhận"], ["/enterprise/sales", "Bán hàng"], ["/enterprise/notices", "Cảnh báo và thu hồi"]] },
];

export function RoleDesk() {
  const { access, can } = useWorkspaceAccess();
  const tasks = useQuery({ queryKey: ["ws-distribution-tasks"], queryFn: wapi.distributionTasks, enabled: can("distribution.read") });
  if (!access) return null;
  const desks = DESKS.filter((d) => access.capabilities.includes(d.capability));
  if (!desks.length) return null;
  const pending = tasks.data?.transfers.length ?? 0;
  const alerts = tasks.data?.stock.length ?? 0;
  return (
    <Section title={tr("Việc theo vai trò")} bodyClassName="flex flex-col gap-3 p-4">
      {can("distribution.read") && (
        <p className="text-[13px]">
          {tr("Hàng chờ nhận / bàn giao")}: <Badge tone={pending ? "warn" : "ok"}>{pending}</Badge>{" "}
          {tr("Lô cần chú ý (thu hồi, hết hạn, cách ly)")}: <Badge tone={alerts ? "danger" : "ok"}>{alerts}</Badge>{" "}
          <Link className="text-brand underline" href={canUseEnterpriseRoute("/enterprise/inbound", access) ? "/enterprise/inbound" : "/distribution"}>{tr("Mở hộp giao nhận")}</Link>
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {desks.map((d) => (
          <article key={d.capability} className="flex flex-col gap-1.5 rounded-md border border-line p-3">
            <h3 className="text-[13.5px] font-semibold">{tr(d.title)}</h3>
            <p className="text-[12.5px] text-ink-2">{tr(d.hint)}</p>
            <div className="flex flex-wrap gap-2 text-[13px]">
              {d.links.filter(([href]) => canUseEnterpriseRoute(href, access)).map(([href, label]) => (
                <Link key={href} className="text-brand underline" href={href}>{tr(label)}</Link>
              ))}
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}
