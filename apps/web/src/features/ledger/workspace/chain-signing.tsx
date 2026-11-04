"use client";
import {z} from "zod";
import {usePendingCommands} from "@/lib/use-pending-commands";
import {useAuth} from "@/lib/auth-store";
import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import {chainApi} from "@/lib/ledger/chain-api";
import {deviceScope,distributionKeyStore} from "@/lib/distribution-signer";
import {wapi} from "@/lib/ledger/workspace-api";
import {fmtDateTime} from "@/lib/ledger/format";
import {DeviceKeyCard} from "./device-key";
import {useWorkspaceAccess} from "@/lib/ledger/workspace-context";
import {t as tr} from "@/lib/ledger/i18n";
import {CommandDialog,useDialog} from "@/components/ledger/kit/command-dialog";
import {PageHeader,PageBody,Section,Callout,ErrorState,LoadingRows} from "@/components/ledger/kit/page";
import {Badge} from "@/components/ledger/kit/status";
import {Button} from "@/components/ledger/ui/button";
const distributionOperations=["EW_REVOKE_DISTRIBUTION_KEY"] as const;
/**
 * Standard handover keys. Each member's key is created in the browser or app
 * on first sign-in and signs right away; the primary account
 * sees every key of the organization and revokes a lost or unknown device.
 */
export default function DistributionSigningPage(){
 const pending=usePendingCommands(distributionOperations);
 const {user}=useAuth(),{primary,can}=useWorkspaceAccess(),q=useQuery({queryKey:["ws-distribution-keys"],queryFn:chainApi.distributionKeys}),members=useQuery({queryKey:["ws-members"],queryFn:wapi.members,enabled:primary}),local=useQuery({queryKey:["local-device-keys",user?.id],queryFn:()=>distributionKeyStore.list(deviceScope(user!.id),user?.organizationId??""),enabled:!!user}),revoke=useDialog<string>(),manage=primary&&can("roles.manage");
 const owner=(id:string|null)=>id===null?tr("Khóa doanh nghiệp (cũ)"):id===user?.id?tr("Bạn"):members.data?.find(m=>m.id===id)?.fullName??tr("Thành viên");
 const STATUS:Record<string,[string,"ok"|"info"|"neutral"]>={ACTIVE:[tr("Hoạt động"),"ok"],REVOKED:[tr("Đã thu hồi"),"neutral"]};
 return <><PageHeader title={tr("Khóa ký bàn giao")} description={tr("Khóa riêng nằm trên thiết bị và được tạo tự động khi đăng nhập; máy chủ chỉ nhận khóa công khai. Máy bị mất hoặc lạ thì tài khoản chủ doanh nghiệp thu hồi khóa.")}/><PageBody><DeviceKeyCard/>{pending&&<Callout tone="warn">{tr("Đối soát yêu cầu khóa đang chờ trước khi thu hồi khóa khác.")}</Callout>}<Section title={primary?tr("Khóa của doanh nghiệp"):tr("Khóa của bạn")} bodyClassName="flex flex-col gap-3 p-4">{q.error?<ErrorState error={q.error}/>:!q.data?<LoadingRows/>:q.data.length===0?<p className="text-[12.5px] text-ink-2">{tr("Chưa có khóa nào.")}</p>:q.data.map(k=><div key={k.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-3 text-sm"><span className="min-w-0 flex-1"><span className="font-medium">{owner(k.userId)}</span> · <span>{k.label}</span><span className="block font-mono text-[11.5px] text-ink-2">{fmtDateTime(k.createdAt)}</span></span><Badge tone={STATUS[k.status]?.[1]??"neutral"}>{STATUS[k.status]?.[0]??k.status}</Badge>{local.data?.some(x=>x.id===k.id)&&<Badge tone="neutral" dot={false}>{tr("Trên thiết bị này")}</Badge>}{manage&&k.status!=="REVOKED"&&<Button size="xs" variant="outline" onClick={()=>revoke.open(k.id)}>{tr("Thu hồi")}</Button>}</div>)}</Section>{revoke.target&&<CommandDialog {...revoke.props} title={tr("Thu hồi khóa ký")} endpoint={`POST /distribution/keys/${revoke.target}/revoke`} description={tr("Thiết bị đó không ký được nữa. Nếu là máy của nhân viên, lần đăng nhập sau sẽ tạo khóa mới.")} schema={z.object({})} defaultValues={{}} submitLabel={tr("Thu hồi")} tone="danger" invalidate={[["ws-distribution-keys"]]} run={(_,cmd)=>chainApi.revokeDistributionKey(revoke.target!,cmd)}>{()=>null}</CommandDialog>}</PageBody></>;
}
