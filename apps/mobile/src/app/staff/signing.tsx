import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { errorText, newIdempotencyKey, type Schemas } from '../../api/client';
import { useSession } from '../../auth/session';
import { DeviceKeyCard } from '../../components/DeviceKeyCard';
import { Button, Card, GreenHeader, Loading, Notice, Pill, T } from '../../components/ui';
import { useAccess } from '../../lib/access';
import { createChainKey, listDeviceKeys } from '../../lib/signing/keys';
import { useLoad, useReloadOnFocus } from '../../lib/useApi';
import { color } from '../../theme/tokens';

type Chain = { id: string; name: string };
type Context = { chainId: string; bindingDigest: string | null; handoverMode: string; keys: { keyRef: string; status: string; label: string }[] };
type Pending = { path: string; body: unknown; idempotencyKey: string };
const KEY_STATUS: Record<string, { label: string; t: 'green' | 'orange' | 'red' }> = {
  ACTIVE: { label: 'Hoạt động', t: 'green' }, REVOKED: { label: 'Đã thu hồi', t: 'red' },
};

/**
 * Signing keys on this phone. Each member's standard handover key is created
 * automatically and signs right away; chains pinned to dual
 * signing still need a chain key the enterprise administrator creates and the
 * ledger activates.
 */
export default function Signing() {
  const { chainId } = useLocalSearchParams<{ chainId?: string }>();
  const { call, user } = useSession<Schemas['AuthUserDto']>();
  const { access } = useAccess();
  const org = user?.organizationId ?? '';
  const load = useLoad(async () => {
    const chains = (await call<Chain[]>('/supply-chains')).filter((c) => !chainId || c.id === chainId);
    const contexts = await Promise.all(chains.map((c) => call<Context>(`/supply-chains/${c.id}/signing-keys`).catch(() => null)));
    const local = new Set((await Promise.all(chains.map((c) => listDeviceKeys(c.id, org)))).flat().map((k) => k.id));
    return { chains, contexts, local };
  }, [chainId, org]);
  useReloadOnFocus(load.reload);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  // A registration whose answer was lost is resent with the same key and body.
  const pending = useRef<Pending | null>(null);
  const admin = !!access?.primary;

  async function register(make: () => Promise<Pending>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      pending.current ??= await make();
      await call(pending.current.path, { body: pending.current.body, idempotencyKey: pending.current.idempotencyKey });
      pending.current = null;
      setMessage({ kind: 'success', text: 'Đã đăng ký khóa. Khóa chuỗi dùng được khi sổ cái kích hoạt (thường vài phút).' });
      await load.reload();
    } catch (error) {
      setMessage({ kind: 'error', text: `${errorText(error)} Bấm lại để gửi đúng yêu cầu cũ.` });
    } finally {
      setBusy(false);
    }
  }

  const data = load.data;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      <GreenHeader title="Khóa ký trên điện thoại" back />
      <View style={{ padding: 16, gap: 12 }}>
        <Notice kind="info" title="Khóa riêng không rời điện thoại" body="Máy chủ chỉ nhận khóa công khai và bằng chứng sở hữu. Gỡ ứng dụng hoặc đổi máy thì khóa mới được tạo lại và cần mã xác minh mới." />
        <DeviceKeyCard />
        {message && <Notice kind={message.kind} title={message.text} />}
        {load.loading && !data ? <Loading /> : load.error ? <Notice kind="error" title={load.error} /> : data && data.contexts.some((ctx) => ctx?.handoverMode === 'DUAL_SIGNED') && (
          <>
            <T size={18} weight="heavy">Khóa ký kép theo chuỗi</T>
            {data.chains.map((c, i) => {
              const ctx = data.contexts[i];
              if (!ctx || ctx.handoverMode !== 'DUAL_SIGNED') return null;
              return (
                <Card key={c.id} style={{ padding: 16, gap: 8 }}>
                  <T weight="heavy">{c.name}</T>
                  {ctx.keys.length === 0 && <T c={color.muted}>Chưa có khóa chuỗi.</T>}
                  {ctx.keys.map((k) => (
                    <View key={k.keyRef} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <T style={{ flex: 1 }}>{k.label}{data.local.has(k.keyRef) ? ' · trên máy này' : ''}</T>
                      <Pill label={KEY_STATUS[k.status]?.label ?? 'Chờ sổ cái kích hoạt'} t={KEY_STATUS[k.status]?.t ?? 'orange'} />
                    </View>
                  ))}
                  {!admin && <T size={13} c={color.muted}>Quản trị doanh nghiệp tạo khóa chuỗi trên điện thoại ký.</T>}
                  {admin && ctx.bindingDigest && (
                    <Button label="Tạo khóa chuỗi trên máy này" icon="lock" kind="outline" loading={busy} disabled={busy} onPress={() => void register(async () => {
                      const key = await createChainKey({ chainId: c.id, organizationId: org, bindingDigest: ctx.bindingDigest!, label: 'Khóa trên điện thoại' });
                      return { path: `/supply-chains/${c.id}/signing-keys`, body: key, idempotencyKey: newIdempotencyKey() };
                    })} />
                  )}
                </Card>
              );
            })}
            <Button label="Tải lại" kind="outline" loading={load.loading} onPress={() => void load.reload()} />
          </>
        )}
      </View>
    </ScrollView>
  );
}
