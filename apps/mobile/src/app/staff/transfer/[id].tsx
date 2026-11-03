import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { errorText, type Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { Button, Card, Field, GreenHeader, Loading, Notice, Pill, Row, T } from '../../../components/ui';
import { dateTime, qty } from '../../../lib/format';
import { readQueue } from '../../../lib/queue';
import type { PreparedIntent } from '../../../lib/signing/canonical';
import { deviceSigningKey, signPrepared, signStandard, type SignableTransfer } from '../../../lib/signing/transfer';
import { retryCommand, sendCommand, type CommandOutcome } from '../../../lib/staff-command';
import { currentAttestations, transferStatus, type TransferDetail } from '../../../lib/transfers';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

type Detail = TransferDetail & SignableTransfer & { allowedActions: string[]; receiverSiteId?: string | null };
const PHASE: Record<string, string> = { CONSENT: 'Đồng thuận bàn giao', PICKUP: 'Ký lấy hàng', DELIVERY: 'Ký giao nhận hàng' };
const DEC = /^\d{1,11}(\.\d{1,3})?$/;
type Message = { kind: 'success' | 'error' | 'warn'; title: string; body?: string };

export default function TransferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call, user } = useSession<Schemas['AuthUserDto']>();
  const { data, error, loading, reload } = useLoad(
    () => call<{ record: Detail }>(`/distribution/transfers/${encodeURIComponent(id)}`), [id],
  );
  useReloadOnFocus(reload);
  const [phase, setPhase] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Record<string, string> | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const transfer = data?.record;
  if (!transfer) return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <GreenHeader title="Chi tiết chuyến hàng" back />
      {loading ? <Loading /> : <View style={{ padding: 16, gap: 12 }}>
        <Notice kind="error" title={error ?? 'Không tìm thấy chuyến hàng'} body="Chuyến không tồn tại hoặc không thuộc phạm vi được giao." />
        <Button label="Thử tải lại" onPress={() => void reload()} />
      </View>}
    </View>
  );
  const status = transferStatus(transfer.status);
  const signatures = currentAttestations(transfer);
  const phases = transfer.allowedActions.filter((a) => a in PHASE);
  const canReceive = transfer.allowedActions.includes('ACTUAL_RECEIPT');
  const signer = user?.organizationId ? { id: user.id, organizationId: user.organizationId } : null;

  const finish = async (outcome: CommandOutcome, done: string) => {
    if (outcome.sent) {
      setMessage({ kind: 'success', title: done });
      setPhase(null);
      setReceipt(null);
      await reload();
    } else setMessage({ kind: outcome.state === 'failed' ? 'error' : 'warn', title: outcome.error,
      body: outcome.state === 'unknown' ? 'Lệnh được giữ trong mục Lệnh chờ gửi để đối soát bằng đúng mã cũ.' : undefined });
  };

  async function sign(selected: string) {
    if (!user || !signer || busy) return;
    setBusy(true);
    setMessage(null);
    setNeedsKey(false);
    try {
      const { mode, key, context } = await deviceSigningKey(call, transfer!, signer);
      if (!key) {
        setNeedsKey(true);
        return;
      }
      if (mode === 'standard') {
        const body = await signStandard(call, transfer!, selected, signer, key.id);
        return await finish(await sendCommand(call, user, { path: `/distribution/transfers/${transfer!.id}/sign`, label: PHASE[selected], detail: `${transfer!.origin} → ${transfer!.destination}`, body }), 'Đã ký và gửi bàn giao');
      }
      // A prepare whose result was lost is reconciled with its original key.
      const preparePath = `/distribution/transfers/${transfer!.id}/c2/prepare`;
      const pending = (await readQueue(user)).find((c) => c.path === preparePath);
      const prepared = pending
        ? await retryCommand(call, user, pending)
        : await sendCommand(call, user, { path: preparePath, label: 'Chuẩn bị ký bàn giao', detail: PHASE[selected], body: { phase: selected, version: transfer!.version, keyRef: key.id } });
      if (!prepared.sent) return await finish(prepared, '');
      const body = await signPrepared(transfer!, selected, signer, context!, key.id, (prepared.result as { items: PreparedIntent[] }).items);
      await finish(await sendCommand(call, user, { path: `/distribution/transfers/${transfer!.id}/c2/submit`, label: PHASE[selected], detail: `${transfer!.origin} → ${transfer!.destination}`, body }), 'Đã ký và gửi bàn giao');
    } catch (cause) {
      setMessage({ kind: 'error', title: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function submitReceipt() {
    if (!user || !receipt || busy) return;
    const lines = transfer!.lines.map((l) => ({ lotId: l.lotId, received: receipt[l.lotId] ?? '', quarantined: '0', rejected: '0' }));
    if (lines.some((l) => !DEC.test(l.received))) return setMessage({ kind: 'error', title: 'Nhập lượng thực nhận cho từng lô (tối đa 3 chữ số thập phân).' });
    if (reason.trim().length < 3) return setMessage({ kind: 'error', title: 'Ghi chú nhận hàng tối thiểu 3 ký tự.' });
    setBusy(true);
    setMessage(null);
    try {
      await finish(await sendCommand(call, user, {
        path: `/distribution/transfers/${transfer!.id}/receipt`, label: 'Ghi lượng thực nhận', detail: `${transfer!.origin} → ${transfer!.destination}`,
        body: { version: transfer!.version, reason: reason.trim(), lines },
      }), 'Đã ghi lượng thực nhận. Tiếp tục ký giao nhận hàng.');
    } catch (cause) {
      setMessage({ kind: 'error', title: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      <GreenHeader title="Chi tiết chuyến hàng" back />
      <View style={{ padding: 16, gap: 12 }}>
        <Card style={{ padding: 16, gap: 8 }}>
          <Pill label={status.label} t={status.t} />
          <Row label="Nơi gửi" value={transfer.origin} />
          <Row label="Nơi nhận" value={transfer.destination} />
          <Row label="Bên gửi" value={transfer.senderName ?? '—'} />
          <Row label="Vận chuyển" value={transfer.carrierName ?? '—'} />
          <Row label="Bên nhận" value={transfer.receiverName ?? '—'} />
          <Row label="Tạo lúc" value={dateTime(transfer.createdAt)} />
          <Row label="Phiên bản" value={`v${transfer.version}`} mono />
        </Card>
        {message && <Notice kind={message.kind} title={message.title} body={message.body} />}
        {needsKey && (
          <Notice kind="warn" title="Điện thoại chưa có khóa ký đang hoạt động"
            body="Tạo khóa ký trên điện thoại này, chờ kích hoạt rồi ký lại."
            action={<Button label="Thiết lập khóa ký" onPress={() => router.push(`/staff/signing?chainId=${transfer.chainId}`)} />} />
        )}
        {canReceive && !receipt && (
          <Button label="Ghi lượng thực nhận" icon="box" onPress={() => { setReceipt(Object.fromEntries(transfer.lines.map((l) => [l.lotId, l.quantity]))); setReason('Nhận đủ hàng'); setMessage(null); }} />
        )}
        {receipt && (
          <Card style={{ padding: 16, gap: 10 }}>
            <T size={16} weight="heavy">Lượng thực nhận</T>
            <T size={13} c={color.muted}>Phần thiếu, cách ly hoặc từ chối ghi trên Web nếu cần.</T>
            {transfer.lines.map((l) => (
              <Field key={l.lotId} label={`${l.lotCode ?? 'Lô'} · gửi ${qty(l.quantity, l.unit)}`} keyboardType="decimal-pad"
                value={receipt[l.lotId] ?? ''} onChangeText={(v) => setReceipt({ ...receipt, [l.lotId]: v })} />
            ))}
            <Field label="Ghi chú nhận hàng" value={reason} onChangeText={setReason} />
            <Button label="Gửi lượng thực nhận" loading={busy} disabled={busy} onPress={() => void submitReceipt()} />
            <Button label="Hủy" kind="outline" onPress={() => setReceipt(null)} />
          </Card>
        )}
        {phases.length > 0 && !receipt && (
          phase ? (
            <Card style={{ padding: 16, gap: 10 }}>
              <T size={16} weight="heavy">Kiểm tra trước khi ký: {PHASE[phase]}</T>
              <T>{transfer.origin} → {transfer.destination} · v{transfer.version}</T>
              {transfer.lines.map((l) => <T key={l.lotId}>• {l.lotCode ?? 'Lô'} · {qty(l.quantity, l.unit)}</T>)}
              <T size={13} c={color.muted}>Khóa riêng nằm trên điện thoại. Máy chủ xác minh chữ ký trước khi chuyển quyền giữ hàng.</T>
              <Button label="Ký và gửi" icon="pen" loading={busy} disabled={busy} onPress={() => void sign(phase)} />
              <Button label="Hủy" kind="outline" disabled={busy} onPress={() => setPhase(null)} />
            </Card>
          ) : (
            phases.map((p) => <Button key={p} label={PHASE[p]} icon="pen" onPress={() => { setPhase(p); setMessage(null); }} />)
          )
        )}
        <T size={18} weight="heavy">Các lô trong chuyến</T>
        {transfer.lines.length === 0 && <Notice kind="warn" title="Chuyến chưa có dòng hàng" />}
        {transfer.lines.map((line) => (
          <Card key={line.id} style={{ padding: 16, gap: 8 }}>
            <T size={16} weight="heavy">{line.productName ?? 'Sản phẩm'}</T>
            <T>{line.lotCode ?? 'Chưa có mã lô'} · {qty(line.quantity, line.unit)}</T>
            <Button label="Xem lô nguồn" kind="outline" onPress={() => router.push(`/staff/lot/${line.lotId}`)} />
          </Card>
        ))}
        <T size={18} weight="heavy">Chữ ký lượt hiện tại</T>
        {signatures.length === 0 && <Notice kind="info" title="Chưa có chữ ký ở lượt hiện tại" />}
        {signatures.map((signature) => (
          <Card key={signature.id} style={{ padding: 16, gap: 4 }}>
            <T weight="heavy">{signature.phaseLabel} · {signature.organizationName}</T>
            <T size={13} c={color.muted}>{dateTime(signature.createdAt)}</T>
          </Card>
        ))}
        <Button label="Tải lại chuyến hàng" kind="outline" loading={loading} onPress={() => void reload()} />
      </View>
    </ScrollView>
  );
}
