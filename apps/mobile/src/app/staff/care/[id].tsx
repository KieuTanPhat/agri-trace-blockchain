import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Schemas } from '../../../api/client';
import { useSession, useSessionScope } from '../../../auth/session';
import { PhotoSlot } from '../../../components/PhotoSlot';
import { Button, Card, Chips, Field, Header, Loading, Notice, T } from '../../../components/staff/ui';
import { sendCommand, uploadCycleImage, type Photo } from '../../../lib/staffApi';
import type { CommandOutcome } from '../../../lib/staff-command';
import { useLoad } from '../../../lib/useApi';
import { useSubmission } from '../../../lib/use-submission';
import { color } from '../../../theme/staff';

/** Same list as the Web journal (apps/web/src/lib/ledger/ops-labels.ts). */
const CARE_TYPES = ['Tưới nước', 'Bón phân', 'Phun thuốc', 'Làm cỏ', 'Theo dõi sâu bệnh', 'Khác'];

export default function Care() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scope = useSessionScope();
  return <CareForm key={JSON.stringify([scope, id])} id={id} />;
}

function CareForm({ id }: { id: string }) {
  const insets = useSafeAreaInsets();
  const { user, call } = useSession<Schemas['AuthUserDto']>();
  const { data: cycle, loading, error: loadError, reload } = useLoad(() => call<Schemas['CycleDetailDto']>(`/production-cycles/${id}`), [id]);
  const [careType, setCareType] = useState(CARE_TYPES[0]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const { run, busy, error } = useSubmission();
  const [done, setDone] = useState<CommandOutcome | null>(null);

  if (!cycle)
    return (
      <View style={{ flex: 1 }}>
        <Header title="Ghi nhật ký" back />
        {loading ? <Loading /> : (
          <View style={{ padding: 16, gap: 12 }}>
            <Notice kind="error" title={loadError ?? 'Không tìm thấy mùa vụ'} />
            <Button label="Thử tải lại" onPress={() => void reload()} />
          </View>
        )}
      </View>
    );
  const writable = cycle.canWriteProduction === true && ['PLANTED', 'GROWING'].includes(cycle.currentState);
  const ready = writable && name.trim().length > 0 && !!photo && !!user;

  const submit = async () => {
    if (!ready || !user) return;
    await run(async (isCurrent) => {
      // Capture the report once; retries keep this exact body and server-time intent.
      const timing = { eventTimeSource: 'SERVER_RECEIVED' as const, eventTime: new Date().toISOString() };
      const evidenceRef = await uploadCycleImage(call, cycle.id, photo!, 'CARE_IMAGE', `Ảnh nhật ký ${careType.toLowerCase()} – ${name.trim()}`.slice(0, 1000));
      if (!isCurrent()) return;
      const outcome = await sendCommand(call, user, {
        path: `/production-cycles/${cycle.id}/care`,
        label: `Nhật ký: ${careType}`,
        detail: `${cycle.product.productName} · ${name.trim()}`,
        body: {
          version: cycle.version,
          careType,
          name: name.trim(),
          ...timing,
          evidenceRef,
          performerUserId: user.id,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      if (isCurrent()) setDone(outcome);
    });
  };

  if (done)
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <Header title="Ghi nhật ký" back />
        <View style={{ padding: 16, gap: 14 }}>
          {done.sent ? <Notice kind="success" title="Đã ghi nhật ký" body={`${careType} · ${name}`} />
            : <Notice kind={done.state === 'failed' ? 'error' : 'warn'} title={done.state === 'failed' ? 'Nhật ký bị từ chối' : 'Lệnh đang chờ đối soát'} body={done.error} />}
          <Button label={done.sent ? 'Về mùa vụ' : 'Xem lệnh chờ gửi'} onPress={() => (done.sent ? router.back() : router.replace('/staff/sync'))} />
        </View>
      </View>
    );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: color.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Header title="Ghi nhật ký" back>
          <T size={14.5} weight="bold" c={color.muted}>
            {cycle.product.productName} · {cycle.farm.name}
          </T>
        </Header>
        <View style={{ marginTop: 16, paddingHorizontal: 16, gap: 12 }}>
          <Card style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Image source={require('../../../../assets/icons/watering.png')} style={{ width: 48, height: 48 }} contentFit="contain" accessibilityLabel="Tưới nước và chăm sóc cây" />
              <View style={{ flex: 1, gap: 2 }}>
                <T size={15} weight="bold">Chăm sóc cây</T>
                <T size={12} c={color.muted}>Chọn công việc đã thực hiện</T>
              </View>
            </View>
            <Chips value={careType} onChange={setCareType} items={CARE_TYPES.map((t) => ({ key: t, label: t }))} />
            <Field label="Việc đã làm" required value={name} onChangeText={setName} placeholder="Ví dụ: tưới nhỏ giọt 30 phút" />
            <Field label="Ghi chú" value={note} onChangeText={setNote} placeholder="Không bắt buộc" />
          </Card>
          <Card style={{ padding: 16, gap: 10 }}>
            <T size={15} weight="bold">
              Ảnh minh chứng <T c={color.red}>*</T>
            </T>
            <PhotoSlot label="Ảnh công việc" photo={photo} onChange={setPhoto} />
            <T size={12} c={color.redDeep}>Bắt buộc có ảnh để lưu sự kiện chăm sóc.</T>
          </Card>
          {!writable && <Notice kind="warn" title="Không thể ghi vào vụ này" body="Vụ chưa bắt đầu, đã kết thúc hoặc bạn không còn quyền ghi. Quay lại mùa vụ để kiểm tra phân công." />}
          {error && <Notice kind="error" title={error} />}
        </View>
      </ScrollView>
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 16 }}>
        <Button label="Lưu nhật ký" onPress={() => void submit()} disabled={!ready} loading={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}
