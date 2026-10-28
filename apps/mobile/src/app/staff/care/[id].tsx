import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorText, type Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { PhotoSlot } from '../../../components/PhotoSlot';
import { Button, Card, Field, GreenHeader, Loading, Notice, T } from '../../../components/ui';
import { sendCommand, uploadCycleImage, type Photo } from '../../../lib/staffApi';
import { useLoad } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

/** Same list as the Web journal (apps/web/src/lib/ledger/ops-labels.ts). */
const CARE_TYPES = ['Tưới nước', 'Bón phân', 'Phun thuốc', 'Làm cỏ', 'Theo dõi sâu bệnh', 'Khác'];

export default function Care() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user, call } = useSession<Schemas['AuthUserDto']>();
  const { data: cycle } = useLoad(() => call<Schemas['CycleDetailDto']>(`/production-cycles/${id}`), [id]);
  const [careType, setCareType] = useState(CARE_TYPES[0]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'sent' | 'queued' | null>(null);

  if (!cycle)
    return (
      <View style={{ flex: 1 }}>
        <GreenHeader title="Ghi nhật ký" back />
        <Loading />
      </View>
    );
  const ready = name.trim().length > 0 && !!photo && !!user;

  const submit = async () => {
    if (!ready || !user) return;
    setBusy(true);
    setError(null);
    try {
      const evidenceRef = await uploadCycleImage(call, cycle.id, photo!, 'CARE_IMAGE', `Ảnh nhật ký ${careType.toLowerCase()} – ${name.trim()}`.slice(0, 1000));
      const outcome = await sendCommand(call, user, {
        path: `/production-cycles/${cycle.id}/care`,
        label: `Nhật ký: ${careType}`,
        detail: `${cycle.product.productName} · ${name.trim()}`,
        body: {
          version: cycle.version,
          careType,
          name: name.trim(),
          eventTime: new Date().toISOString(),
          evidenceRef,
          performerUserId: user.id,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setDone(outcome.sent ? 'sent' : 'queued');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <GreenHeader title="Ghi nhật ký" back />
        <View style={{ padding: 16, gap: 14 }}>
          {done === 'sent' ? <Notice kind="success" title="Đã ghi nhật ký" body={`${careType} · ${name}`} /> : <Notice kind="warn" title="Lệnh đang chờ đối soát" body="Lệnh đã lưu trên máy và sẽ gửi lại bằng đúng mã lệnh." />}
          <Button label={done === 'queued' ? 'Xem lệnh chờ gửi' : 'Về mùa vụ'} onPress={() => (done === 'queued' ? router.replace('/staff/sync') : router.back())} />
        </View>
      </View>
    );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: color.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <GreenHeader title="Ghi nhật ký" back extraBottom={44}>
          <T size={14.5} weight="bold" c="#fff" style={{ textAlign: 'center' }}>
            {cycle.product.productName} · {cycle.farm.name}
          </T>
        </GreenHeader>
        <View style={{ marginTop: -40, paddingHorizontal: 16, gap: 12 }}>
          <Card style={{ padding: 16, gap: 12 }}>
            <T size={15.5} weight="heavy">
              Loại công việc
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CARE_TYPES.map((t) => (
                <Pressable key={t} accessibilityRole="radio" accessibilityState={{ selected: careType === t }} onPress={() => setCareType(t)} style={{ paddingHorizontal: 14, height: 42, borderRadius: 999, justifyContent: 'center', borderWidth: 1.5, borderColor: careType === t ? color.purple : color.field, backgroundColor: careType === t ? color.purpleTint : '#fff' }}>
                  <T size={14.5} weight="heavy" c={careType === t ? color.purpleDeep : color.inkSoft}>
                    {t}
                  </T>
                </Pressable>
              ))}
            </View>
            <Field label="Việc đã làm" required value={name} onChangeText={setName} placeholder="Ví dụ: tưới nhỏ giọt 30 phút" />
            <Field label="Ghi chú" value={note} onChangeText={setNote} placeholder="Không bắt buộc" />
          </Card>
          <Card style={{ padding: 16, gap: 10 }}>
            <T size={15.5} weight="heavy">
              Ảnh minh chứng <T c={color.red}>*</T>
            </T>
            <PhotoSlot label="Ảnh công việc" photo={photo} onChange={setPhoto} />
          </Card>
          {error && <Notice kind="error" title={error} />}
        </View>
      </ScrollView>
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 16 }}>
        <Button label="Lưu nhật ký" onPress={() => void submit()} disabled={!ready} loading={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}
