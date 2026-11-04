"use client";
import { useState } from "react";
import { useAuth } from "@/lib/auth-store";
import { useLedgerQuery as useQuery, useLedgerQueryClient } from "@/lib/ledger/data";
import { chainApi } from "@/lib/ledger/chain-api";
import { newLedgerCommandKey } from "@/lib/ledger/command-context";
import { getLedgerError } from "@/lib/ledger/errors";
import { t as tr } from "@/lib/ledger/i18n";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { ensureDeviceKey } from "@/lib/device-key";
import { ed25519Supported } from "@/lib/signing/signer";
import { Callout } from "@/components/ledger/kit/page";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";

/**
 * The member's personal signing key in this browser. It is created
 * automatically; the member only types the code emailed to the account to
 * turn it on. `quiet` hides the card once the key works.
 */
export function DeviceKeyCard({ quiet }: { quiet?: boolean }) {
  const { user } = useAuth();
  const { can } = useWorkspaceAccess();
  const qc = useLedgerQueryClient();
  const member = can("distribution.sign") && user?.organizationId ? { id: user.id, organizationId: user.organizationId } : null;
  const support = useQuery({ queryKey: ["ed25519-supported"], queryFn: ed25519Supported });
  const key = useQuery({ queryKey: ["device-key", member?.id], queryFn: () => ensureDeviceKey(member!), enabled: !!member && support.data === true, retry: false });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (!member || (quiet && key.data?.state === "active")) return null;
  if (support.data === false) return <Callout tone="warn">{tr("Trình duyệt chưa hỗ trợ Ed25519 nên không tạo được khóa ký. Dùng Chrome hoặc Edge bản mới.")}</Callout>;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["device-key", member.id] }), qc.invalidateQueries({ queryKey: ["ws-distribution-keys"] })]);

  async function act(run: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (cause) {
      setError(getLedgerError(cause)?.message ?? (cause instanceof Error ? cause.message : tr("Chưa thực hiện được")));
    } finally {
      setBusy(false);
    }
  }
  const pending = key.data?.state === "pending" ? key.data : null;
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-card p-4">
      <h3 className="text-[13px] font-semibold">{tr("Khóa ký của bạn trên trình duyệt này")}</h3>
      {key.error && <Callout tone="danger">{getLedgerError(key.error)?.message ?? key.error.message} <Button size="xs" variant="outline" onClick={() => void key.refetch()}>{tr("Thử lại")}</Button></Callout>}
      {key.isLoading && <p className="text-[12.5px] text-ink-2">{tr("Đang chuẩn bị khóa ký…")}</p>}
      {key.data?.state === "active" && <Callout tone="info">{tr("Khóa ký đang hoạt động; bạn ký bàn giao được trên trình duyệt này.")}</Callout>}
      {pending && (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void act(async () => { await chainApi.verifyDeviceKey(pending.keyId, code, { idempotencyKey: newLedgerCommandKey() }); setCode(""); await refresh(); }); }}>
          <p className="text-[13px]">{tr("Nhập mã 6 số đã gửi tới {p0} để bật khóa ký. Không phải bạn thao tác thì đừng nhập mã và báo quản trị doanh nghiệp.", { p0: sentTo ?? pending.email ?? tr("email tài khoản") })}</p>
          <label className="flex flex-col gap-1 text-sm">{tr("Mã xác minh")}<Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
          <span className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={busy || code.length !== 6}>{tr("Xác minh")}</Button>
            <Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => void act(async () => setSentTo((await chainApi.resendDeviceKey(pending.keyId, { idempotencyKey: newLedgerCommandKey() })).record.email))}>{tr("Gửi lại mã")}</Button>
          </span>
        </form>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
    </section>
  );
}
