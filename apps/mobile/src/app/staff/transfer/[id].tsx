import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { errorText, type Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { PhotoStrip } from '../../../components/PhotoStrip';
import { Button, Card, Field, Header, Loading, Notice, Pill, Row, T } from '../../../components/staff/ui';
import { dateTime, qty } from '../../../lib/format';
import { readQueue } from '../../../lib/queue';
import type { PreparedIntent } from '../../../lib/signing/canonical';
import { assertPhotosDigest, deviceSigningKey, signPrepared, signStandard, type SignableTransfer } from '../../../lib/signing/transfer';
import { uploadPhotos, type Photo } from '../../../lib/staffApi';
import { retryCommand, sendCommand, type CommandOutcome } from '../../../lib/staff-command';
import { currentAttestations, transferStatus, type TransferDetail } from '../../../lib/transfers';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color } from '../../../theme/staff';

type Detail = TransferDetail & SignableTransfer & { allowedActions: string[]; receiverSiteId?: string | null; photos?: { phase: string; evidenceId: string }[] };
type ReceiptRow = { received: string; rejected: string; quarantined: string };
const PHASE: Record<string, string> = { CONSENT: 'Đồng thuận bàn giao', PICKUP: 'Ký lấy hàng', DELIVERY: 'Ký giao nhận hàng' };
const PHOTO_PHASE: Record<string, string> = { PICKUP: 'Ảnh lúc lấy hàng', DELIVERY: 'Ảnh lúc giao hàng' };
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
  const [receipt, setReceipt] = useState<Record<string, ReceiptRow> | null>(null);
  const [handoverPhotos, setHandoverPhotos] = useState<Photo[]>([]);
  const [receiptPhotos, setReceiptPhotos] = useState<Photo[]>([]);
  // Uploaded photo ids by uri: a resent command reuses the same evidence.
  const uploaded = useRef(new Map<string, string>());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const transfer = data?.record;
  if (!transfer) return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title="Chi tiết chuyến hàng" back />
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
  const photoPhase = ['PICKUP', 'DELIVERY'].find((p) => transfer.allowedActions.includes(`PHOTOS_${p}`));
  const photoCount = (p: string) => (transfer.photos ?? []).filter((x) => x.phase === p).length;
  const receiptRows = receipt
    ? transfer.lines.map((l) => ({ lotId: l.lotId, sent: Number(l.quantity), ...(receipt[l.lotId] ?? { received: '', rejected: '0', quarantined: '0' }) }))
    : [];
  const discrepancy = receiptRows.some((l) => Number(l.rejected) > 0 || Number(l.quarantined) > 0 || Number(l.received) + Number(l.rejected) < l.sent);
  const signer = user?.organizationId ? { id: user.id, organizationId: user.organizationId } : null;

  const finish = async (outcome: CommandOutcome, done: string) => {
    if (outcome.sent) {
      setMessage({ kind: 'success', title: done });
      setPhase(null);
      setReceipt(null);
      setHandoverPhotos([]);
      setReceiptPhotos([]);
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
      assertPhotosDigest(transfer!);
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

  async function attachPhotos(selected: string) {
    if (!user || busy) return;
    if (!handoverPhotos.length) return setMessage({ kind: 'error', title: 'Chụp ít nhất một ảnh.' });
    setBusy(true);
    setMessage(null);
    try {
      const photos = await uploadPhotos(call, { entityType: 'TRANSFER', entityId: transfer!.id, kind: 'TRANSFER_IMAGE', description: PHOTO_PHASE[selected] }, handoverPhotos, uploaded.current);
      await finish(await sendCommand(call, user, {
        path: `/distribution/transfers/${transfer!.id}/photos`, label: PHOTO_PHASE[selected], detail: `${transfer!.origin} → ${transfer!.destination}`,
        body: { version: transfer!.version, phase: selected, photos },
      }), 'Đã gắn ảnh. Ảnh nằm trong nội dung các bên sẽ ký.');
    } catch (cause) {
      setMessage({ kind: 'error', title: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function submitReceipt() {
    if (!user || !receipt || busy) return;
    const lines = receiptRows.map(({ lotId, received, rejected, quarantined }) => ({ lotId, received, rejected, quarantined }));
    if (lines.some((l) => !DEC.test(l.received) || !DEC.test(l.rejected) || !DEC.test(l.quarantined)))
      return setMessage({ kind: 'error', title: 'Nhập số lượng cho từng lô (tối đa 3 chữ số thập phân).' });
    if (receiptRows.some((l) => Number(l.received) + Number(l.rejected) > l.sent || Number(l.quarantined) > Number(l.received)))
      return setMessage({ kind: 'error', title: 'Thực nhận + từ chối không vượt lượng gửi; cách ly không vượt thực nhận.' });
    if (discrepancy && !receiptPhotos.length)
      return setMessage({ kind: 'error', title: 'Chụp ít nhất một ảnh khi nhận thiếu, từ chối hoặc cách ly hàng.' });
    if (reason.trim().length < 10) return setMessage({ kind: 'error', title: 'Ghi chú nhận hàng tối thiểu 10 ký tự.' });
    setBusy(true);
    setMessage(null);
    try {
      const photos = await uploadPhotos(call, { entityType: 'TRANSFER', entityId: transfer!.id, kind: 'TRANSFER_IMAGE', description: 'Ảnh hàng thực nhận' }, receiptPhotos, uploaded.current);
      await finish(await sendCommand(call, user, {
        path: `/distribution/transfers/${transfer!.id}/receipt`, label: 'Ghi lượng thực nhận', detail: `${transfer!.origin} → ${transfer!.destination}`,
        body: { version: transfer!.version, reason: reason.trim(), lines, ...(photos.length ? { photos } : {}) },
      }), 'Đã ghi lượng thực nhận. Tiếp tục ký giao nhận hàng.');
    } catch (cause) {
      setMessage({ kind: 'error', title: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      <Header title="Chi tiết chuyến hàng" back />
      <View style={{ padding: 16, gap: 12 }}>
        <Card style={{ padding: 16, gap: 8 }}>
          <Pill label={status.label} t={status.t} />
          <Row first icon="location" label="Nơi gửi" value={transfer.origin} />
          <Row icon="location" label="Nơi nhận" value={transfer.destination} />
          <Row icon="building" label="Bên gửi" value={transfer.senderName ?? '—'} />
          <Row icon="truck" label="Vận chuyển" value={transfer.carrierName ?? '—'} />
          <Row icon="building" label="Bên nhận" value={transfer.receiverName ?? '—'} />
          <Row icon="clock" label="Tạo lúc" value={dateTime(transfer.createdAt)} />
          <Row icon="info" label="Phiên bản" value={`v${transfer.version}`} mono />
        </Card>
        {message && <Notice kind={message.kind} title={message.title} body={message.body} />}
        {needsKey && (
          <Notice kind="warn" title="Điện thoại chưa có khóa ký đang hoạt động"
            body="Tạo khóa ký trên điện thoại này, chờ kích hoạt rồi ký lại."
            action={<Button label="Thiết lập khóa ký" onPress={() => router.push(`/staff/signing?chainId=${transfer.chainId}`)} />} />
        )}
        {canReceive && !receipt && (
          <Button label="Ghi lượng thực nhận" icon="box" onPress={() => { setReceipt(Object.fromEntries(transfer.lines.map((l) => [l.lotId, { received: l.quantity, rejected: '0', quarantined: '0' }]))); setReason('Nhận đủ hàng, bao bì nguyên vẹn'); setMessage(null); }} />
        )}
        {receipt && (
          <Card style={{ padding: 16, gap: 10 }}>
            <T size={16} weight="heavy">Lượng thực nhận</T>
            <T size={13} c={color.muted}>Phần thiếu = gửi − thực nhận − từ chối. Nhận thiếu, từ chối hoặc cách ly cần ảnh.</T>
            {transfer.lines.map((l) => {
              const row = receipt[l.lotId];
              const set = (key: keyof ReceiptRow) => (v: string) => setReceipt({ ...receipt, [l.lotId]: { ...row, [key]: v } });
              return (
                <View key={l.lotId} style={{ gap: 6 }}>
                  <T weight="heavy">{l.lotCode ?? 'Lô'} · gửi {qty(l.quantity, l.unit)}</T>
                  <Field label="Thực nhận" keyboardType="decimal-pad" value={row.received} onChangeText={set('received')} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}><Field label="Từ chối" keyboardType="decimal-pad" value={row.rejected} onChangeText={set('rejected')} /></View>
                    <View style={{ flex: 1 }}><Field label="Cách ly" keyboardType="decimal-pad" value={row.quarantined} onChangeText={set('quarantined')} /></View>
                  </View>
                </View>
              );
            })}
            <PhotoStrip label="Ảnh hàng thực nhận" required={discrepancy} photos={receiptPhotos} onChange={setReceiptPhotos} />
            <Field label="Ghi chú nhận hàng" value={reason} onChangeText={setReason} />
            <Button label="Gửi lượng thực nhận" loading={busy} disabled={busy} onPress={() => void submitReceipt()} />
            <Button label="Hủy" kind="outline" onPress={() => setReceipt(null)} />
          </Card>
        )}
        {photoPhase && !receipt && !phase && (
          <Card style={{ padding: 16, gap: 10 }}>
            <T size={16} weight="heavy">{PHOTO_PHASE[photoPhase]} (không bắt buộc)</T>
            <T size={13} c={color.muted}>Gắn trước khi ký. Khi một bên đã ký bước này thì không thêm ảnh được nữa. Đã gắn {photoCount(photoPhase)} ảnh.</T>
            <PhotoStrip label="Ảnh hàng hóa" photos={handoverPhotos} onChange={setHandoverPhotos} />
            {handoverPhotos.length > 0 && (
              <Button label="Gắn ảnh vào chuyến hàng" icon="camera" loading={busy} disabled={busy} onPress={() => void attachPhotos(photoPhase)} />
            )}
          </Card>
        )}
        {phases.length > 0 && !receipt && (
          phase ? (
            <Card style={{ padding: 16, gap: 10 }}>
              <T size={16} weight="heavy">Kiểm tra trước khi ký: {PHASE[phase]}</T>
              <T>{transfer.origin} → {transfer.destination} · v{transfer.version}</T>
              {transfer.lines.map((l) => <T key={l.lotId}>• {l.lotCode ?? 'Lô'} · {qty(l.quantity, l.unit)}</T>)}
              {photoCount(phase) > 0 && <T>Kèm {photoCount(phase)} ảnh bàn giao; mã băm ảnh nằm trong nội dung ký.</T>}
              {handoverPhotos.length > 0 && (
                <Notice kind="warn" title="Ảnh vừa chụp chưa được gắn" body="Bấm Hủy rồi Gắn ảnh trước, hoặc ký không kèm các ảnh này." />
              )}
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
