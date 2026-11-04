"use client";
import { useAuth } from "@/lib/auth-store";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { getLedgerError } from "@/lib/ledger/errors";
import { t as tr } from "@/lib/ledger/i18n";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { ensureDeviceKey } from "@/lib/device-key";
import { ed25519Supported } from "@/lib/signing/signer";
import { Callout } from "@/components/ledger/kit/page";
import { Button } from "@/components/ledger/ui/button";

/**
 * The member's personal signing key in this browser. It is created and
 * registered automatically and signs right away. `quiet` hides the card once
 * the key works.
 */
export function DeviceKeyCard({ quiet }: { quiet?: boolean }) {
  const { user } = useAuth();
  const { can } = useWorkspaceAccess();
  const member = can("distribution.sign") && user?.organizationId ? { id: user.id, organizationId: user.organizationId } : null;
  const support = useQuery({ queryKey: ["ed25519-supported"], queryFn: ed25519Supported });
  const key = useQuery({ queryKey: ["device-key", member?.id], queryFn: () => ensureDeviceKey(member!), enabled: !!member && support.data === true, retry: false });
  if (!member || (quiet && key.data)) return null;
  if (support.data === false) return <Callout tone="warn">{tr("Trình duyệt chưa hỗ trợ Ed25519 nên không tạo được khóa ký. Dùng Chrome hoặc Edge bản mới.")}</Callout>;
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-card p-4">
      <h3 className="text-[13px] font-semibold">{tr("Khóa ký của bạn trên trình duyệt này")}</h3>
      {key.error && <Callout tone="danger">{getLedgerError(key.error)?.message ?? key.error.message} <Button size="xs" variant="outline" onClick={() => void key.refetch()}>{tr("Thử lại")}</Button></Callout>}
      {key.isLoading && <p className="text-[12.5px] text-ink-2">{tr("Đang chuẩn bị khóa ký…")}</p>}
      {key.data && <Callout tone="info">{tr("Khóa ký đang hoạt động; bạn ký bàn giao được trên trình duyệt này.")}</Callout>}
    </section>
  );
}
