import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorText, type Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { PhotoSlot } from '../../../components/PhotoSlot';
import { Button, Card, Field, GreenHeader, Loading, Notice, T } from '../../../components/ui';
import { qty } from '../../../lib/format';
import { sendCommand, uploadCycleImage, type Photo } from '../../../lib/staffApi';
import { useLoad } from '../../../lib/useApi';
import { color, font, noOutline } from '../../../theme/tokens';

type Cycle = Schemas['CycleDetailDto'];
type Result = Schemas['HarvestResultDto'];

/** One decision per screen, big number field, unit locked to the cycle plan. */
export default function Harvest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user, call } = useSession<Schemas['AuthUserDto']>();
  const { data: cycle } = useLoad(() => call<Cycle>(`/production-cycles/${id}`), [id]);
  const [amount, setAmount] = useState('');
  const [harvestPhoto, setHarvestPhoto] = useState<Photo | null>(null);
  const [lotPhoto, setLotPhoto] = useState<Photo | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Result | 'queued' | null>(null);

  if (!cycle)
    return (
      <View style={{ flex: 1 }}>
        <GreenHeader title="Ghi thu hoạch" back />
        <Loading />
      </View>
    );

  const unit = cycle.harvestUnit ?? cycle.product.defaultUnit ?? 'kg';
  const quantity = Number(amount.replace(/\./g, '').replace(',', '.'));
  const harvested = cycle.harvestEvents.reduce((s, h) => s + Number(h.quantity), 0);
  const cap = cycle.maxHarvestQuantity ? Number(cycle.maxHarvestQuantity) - harvested : null;
  const over = cap !== null && quantity > cap;
  const ready = quantity > 0 && !over && !!harvestPhoto && !!lotPhoto && !!user;

  const submit = async () => {
    if (!ready || !user) return;
    setBusy(true);
    setError(null);
    try {
      const when = new Date();
      const day = when.toLocaleDateString('vi-VN');
      const evidenceRef = await uploadCycleImage(call, cycle.id, harvestPhoto!, 'HARVEST_IMAGE', `Ảnh thu hoạch ${cycle.product.productName} ngày ${day}`);
      const lotImageEvidenceRef = await uploadCycleImage(call, cycle.id, lotPhoto!, 'LOT_IMAGE', `Ảnh lô ${cycle.product.productName} ngày ${day}`);
      const outcome = await sendCommand(call, user, {
        path: `/production-cycles/${cycle.id}/harvests`,
        label: `Thu hoạch ${qty(quantity, unit)}`,
        detail: cycle.product.productName,
        body: {
          version: cycle.version,
          lotName: `${cycle.product.productName} ${day}`,
          representativeUserId: user.id,
          evidenceRef,
          lotImageEvidenceRef,
          harvestTime: when.toISOString(),
          quantity,
          unit,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setDone(outcome.sent ? (outcome.result as Result) : 'queued');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <GreenHeader title="Ghi thu hoạch" back />
        <View style={{ padding: 16, gap: 14 }}>
          {done === 'queued' ? (
            <Notice kind="warn" title="Lệnh đang chờ đối soát" body="Lệnh đã lưu trên máy với mã lệnh riêng và sẽ gửi lại khi có mạng." />
          ) : (
            <>
              <Notice kind="success" title={`Đã ghi thu hoạch ${qty(done.harvest.quantity, done.harvest.unit)}`} body="Lô mới và mã QR truy xuất đã được tạo." />
              <Card style={{ padding: 16, gap: 6 }}>
                <T size={13} weight="heavy" c={color.muted}>
                  MÃ LÔ
                </T>
                <T size={17} weight="heavy" style={{ fontFamily: 'monospace' }}>
                  {done.lot.lotCode}
                </T>
              </Card>
            </>
          )}
          <Button label={done === 'queued' ? 'Xem lệnh chờ gửi' : 'Về mùa vụ'} onPress={() => (done === 'queued' ? router.replace('/staff/sync') : router.back())} />
        </View>
      </View>
    );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: color.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        <GreenHeader title="Ghi thu hoạch" back extraBottom={44}>
          <T size={14.5} weight="bold" c="#fff" style={{ textAlign: 'center' }}>
            {cycle.product.productName} · {cycle.farm.name}
          </T>
        </GreenHeader>
        <View style={{ marginTop: -40, paddingHorizontal: 16, gap: 12 }}>
          <Card style={{ padding: 16, gap: 12 }}>
            <T size={15.5} weight="heavy">
              Khối lượng <T c={color.red}>*</T>
            </T>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, borderBottomWidth: 3, borderBottomColor: over ? color.red : color.green, paddingBottom: 4 }}>
              <TextInput
                value={amount}
                onChangeText={(v) => setAmount(v.replace(/[^\d,]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={color.faint}
                accessibilityLabel={`Khối lượng thu hoạch, đơn vị ${unit}`}
                style={[{ flex: 1, fontFamily: font.heavy, fontSize: 44, color: color.ink, paddingVertical: 2 }, noOutline]}
              />
              <T size={22} weight="heavy" c={color.inkSoft}>
                {unit}
              </T>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[10, 50, 100].map((step) => (
                <Pressable key={step} accessibilityRole="button" onPress={() => setAmount(String((quantity || 0) + step).replace('.', ','))} style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: color.greenTint, alignItems: 'center', justifyContent: 'center' }}>
                  <T size={15} weight="heavy" c={color.greenDeep}>
                    +{step} {unit}
                  </T>
                </Pressable>
              ))}
            </View>
            <T size={13.5} weight={over ? 'heavy' : 'regular'} c={over ? color.redDeep : color.muted}>
              {cap !== null ? `Còn tối đa ${qty(cap, unit)} theo kế hoạch vụ.` : 'Đơn vị cố định theo kế hoạch vụ.'}
            </T>
          </Card>
          <Card style={{ padding: 16, gap: 10 }}>
            <T size={15.5} weight="heavy">
              Ảnh tại vườn <T c={color.red}>*</T>
            </T>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <PhotoSlot label="Ảnh thu hoạch" photo={harvestPhoto} onChange={setHarvestPhoto} />
              <PhotoSlot label="Ảnh lô hàng" photo={lotPhoto} onChange={setLotPhoto} />
            </View>
            <T size={13} c={color.muted}>
              Ảnh lưu riêng tư cho doanh nghiệp, không tự công khai.
            </T>
          </Card>
          <Card style={{ padding: 16 }}>
            <Field label="Ghi chú" value={note} onChangeText={setNote} placeholder="Không bắt buộc" />
          </Card>
          {error && <Notice kind="error" title={error} />}
        </View>
      </ScrollView>
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 16, gap: 6 }}>
        <Button label={quantity > 0 ? `Lưu ${qty(quantity, unit)}` : 'Nhập khối lượng'} onPress={() => void submit()} disabled={!ready} loading={busy} />
        <T size={13} c={color.muted} style={{ textAlign: 'center' }}>
          Mất sóng sau khi tải ảnh: máy giữ lệnh và tự gửi lại bằng đúng mã lệnh.
        </T>
      </View>
    </KeyboardAvoidingView>
  );
}
