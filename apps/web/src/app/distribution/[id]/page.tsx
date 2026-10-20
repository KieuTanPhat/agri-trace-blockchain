"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ReceiptAndReturns } from "@/components/workspace/receipt-returns";
import { signDistributionC2 } from '@/lib/distribution-c2';
import { DataForm } from '@/components/data-form';
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import {
  distributionKeyStore,
  signDistribution,
} from "@/lib/distribution-signer";
import {
  errorMessage,
  labels,
  useWorkspaceData,
  useWorkspaceCommand,
  textValue,
  type Row,
} from "@/lib/workspace";
import { CommandState, LoadState, PageHeader, StatusBadge } from "@/components/manage";
type Challenge = {
  snapshot: unknown;
  snapshotDigest: string;
  domain: string;
  phases: string[];
};
export default function TransferPage() {
  const { id } = useParams<{ id: string }>(),
    auth = useAuth(),
    state = useWorkspaceData<{ record: Row }>(`/distribution/transfers/${id}`),
    cmd = useWorkspaceCommand(),
    [signing, setSigning] = useState(false),
    [error, setError] = useState("");
  const t = state.data?.record;
  const attestations = (t?.attestations ?? []) as Row[];
  const orgId = auth.user?.organizationId;
  const actions = (t?.allowedActions ?? []) as string[];
  const phases = actions.filter(a => ["CONSENT","PICKUP","DELIVERY"].includes(a));
  async function sign(phase: string) {
    if (!t || !auth.user || !orgId) return;
    setSigning(true);
    setError("");
    try {
      if(t.handoverMode==='DUAL_SIGNED') {
        const body=cmd.frozen?{}:await signDistributionC2(t,phase,{id:auth.user.id,organizationId:orgId});
        if(await cmd.run(`/distribution/transfers/${id}/c2/submit`,body))state.reload();
        return;
      }
      const challenge = await request<Challenge>(
        `/distribution/transfers/${id}/challenge`,
      );
      if (!challenge.phases.includes(phase))
        throw new Error("Bước bàn giao đã thay đổi. Tải lại giao nhận.");
      const keys = await distributionKeyStore.list("distribution", orgId),
        active = await request<{ items: Row[] }>("/distribution/keys"),
        key = keys.find((k) =>
          active.items.some((a) => a.id === k.id && a.status === "ACTIVE"),
        );
      if (!key)
        throw new Error(
          "Chưa có khóa ký trên thiết bị. Mở trang Khóa ký bàn giao để đăng ký.",
        );
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString(),
        body = {
          transferId: id,
          phase,
          organizationId: orgId,
          userId: auth.user.id,
          keyRef: key.id,
          version: String(t.version),
          expiresAt,
        };
      const signature = await signDistribution(challenge, body);
      if (
        await cmd.run(`/distribution/transfers/${id}/sign`, {
          phase,
          keyRef: key.id,
          version: t.version,
          expiresAt,
          signature,
        })
      )
        state.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSigning(false);
    }
  }
  async function cancel() {
    if (
      await cmd.run(`/distribution/transfers/${id}/cancel`, {
        version: t?.version,
      })
    )
      state.reload();
  }
  return (
    <div className="manage-console">
      <PageHeader actionKind="create" backLabel="Quay lại danh sách"
        title={`Giao nhận GN-${id.slice(0, 8).toUpperCase()}`}
        description="Đối chiếu lô nguồn, số lượng và các bên trước khi ký. Bàn giao chỉ hoàn tất khi đủ hai phía."
        back="/distribution"
      />
      <LoadState {...state} />
      <CommandState command={cmd} />
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {t && (
        <>
          <div className="workspace-split">
            <section className="panel">
              <StatusBadge value={String(t.status)} />
              <dl className="review-details" style={{ marginTop: 24 }}>
                <dt>Bên giao</dt>
                <dd>{textValue(t.senderName)}</dd>
                <dt>Vận chuyển</dt>
                <dd>{textValue(t.carrierName)}</dd>
                <dt>Bên nhận</dt>
                <dd>{textValue(t.receiverName)}</dd>
                <dt>Điểm giao</dt>
                <dd>{textValue(t.origin)}</dd>
                <dt>Điểm nhận</dt>
                <dd>{textValue(t.destination)}</dd>
                <dt>Dự kiến lấy hàng</dt>
                <dd>{t.plannedPickupAt ? new Date(String(t.plannedPickupAt)).toLocaleString("vi-VN") : "—"}</dd>
                <dt>Dự kiến giao hàng</dt>
                <dd>{t.plannedDeliveryAt ? new Date(String(t.plannedDeliveryAt)).toLocaleString("vi-VN") : "—"}</dd>
                <dt>Ghi chú</dt><dd>{textValue(t.note)}</dd>
              </dl>
            </section>
            <section className="panel">
              <h2>Xác nhận bàn giao</h2>
              <p>
                Kiểm tra nội dung ở bên cạnh. Chữ ký được tạo trên thiết bị bằng
                khóa doanh nghiệp.
              </p>
              {phases.map((phase) =>
                attestations.some(
                  (a) => a.organizationId === orgId && a.phase === phase,
                ) ? (
                  <p className="notice" key={phase}>
                    Bạn đã ký bước {labels[phase]?.toLowerCase()}. Đang chờ các
                    bên còn lại.
                  </p>
                ) : (
                  <button
                    className="button"
                    key={phase}
                    disabled={signing || cmd.pending}
                    onClick={() => void sign(phase)}
                  >
                    {signing
                      ? "Đang ký…"
                      : `Ký ${labels[phase]?.toLowerCase()}`}
                  </button>
                ),
              )}
              <div className="workspace-actions">
                {actions.includes("OBSERVE") && (
                  <Link
                    className="text-link"
                    href={`/distribution/${id}/journal`}
                  >
                    Ghi nhật ký vận chuyển →
                  </Link>
                )}
                <Link className="text-link" href="/enterprise/signing">
                  Quản lý khóa ký →
                </Link>
                {actions.includes("CANCEL") && (
                    <button
                      className="text-link"
                      disabled={cmd.pending}
                      onClick={() => void cancel()}
                    >
                      Hủy trước bàn giao
                    </button>
                  )}
              </div>
            </section>
          </div>
          <ReceiptAndReturns transfer={t} reload={state.reload} />
          {actions.includes('RENEW_CONSENT')&&<DataForm title="Yêu cầu ba bên đồng thuận lại" path={`/distribution/transfers/${id}/consent-renewal`} extra={{version:t.version}} fields={[{name:'reason',label:'Lý do thay quyền, khóa hoặc người ký',required:true,minLength:10,maxLength:1000}]} onSaved={()=>state.reload()}/>}
          <div className="manage-section manage-table-scroll">
            <table className="manage-table">
              <thead>
                <tr>
                  <th>Lô nguồn</th>
                  <th>Sản phẩm</th>
                  <th>Số lượng giao</th>
                </tr>
              </thead>
              <tbody>
                {(t.lines as Row[]).map((l) => (
                  <tr key={String(l.id)}>
                    <td data-label="Lô nguồn">{textValue(l.lotCode)}</td>
                    <td data-label="Sản phẩm">{textValue(l.productName)}</td>
                    <td data-label="Số lượng giao">
                      {textValue(l.quantity)} {textValue(l.unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="panel">
            <h2>Nhật ký xác nhận</h2>
            {!!(t.observations as Row[] | undefined)?.length && (
              <div className="workspace-journey">
                {(t.observations as Row[]).map((o) => (
                  <article key={String(o.id)}>
                    <h3>Ghi nhận vận chuyển</h3>
                    <p>{textValue(o.note)}</p>
                    <p>
                      {o.temperature !== null
                        ? `${textValue(o.temperature)} °C · `
                        : ""}
                      {new Date(String(o.eventTime)).toLocaleString("vi-VN")} ·
                      Quan sát thủ công
                    </p>
                  </article>
                ))}
              </div>
            )}
            <div className="workspace-journey">
              {attestations.map((a) => (
                <article key={String(a.id)}>
                  <h3>{labels[String(a.phase)] ?? String(a.phase)}</h3>
                  <p>
                    {a.organizationId === t.senderId
                      ? textValue(t.senderName)
                      : a.organizationId === t.carrierId
                        ? textValue(t.carrierName)
                        : textValue(t.receiverName)}
                  </p>
                  <p>{new Date(String(a.createdAt)).toLocaleString("vi-VN")}</p>
                </article>
              ))}
            </div>
            {!attestations.length && (
              <p className="muted">Chưa có bên nào ký xác nhận.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
