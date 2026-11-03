import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { errorText, newIdempotencyKey, type Schemas } from '../../api/client';
import { useSession } from '../../auth/session';
import { Button, Card, GreenHeader, Loading, Notice, Pill, T } from '../../components/ui';
import { useAccess } from '../../lib/access';
import { createChainKey, createDistributionKey, listDeviceKeys } from '../../lib/signing/keys';
import { useLoad, useReloadOnFocus } from '../../lib/useApi';
import { color } from '../../theme/tokens';

type Chain = { id: string; name: string };
type Context = { chainId: string; bindingDigest: string | null; handoverMode: string; keys: { keyRef: string; status: string; label: string }[] };
type Pending = { path: string; body: unknown; idempotencyKey: string };
const KEY_STATUS: Record<string, { label: string; t: 'green' | 'orange' | 'red' }> = {
  ACTIVE: { label: 'Hoạt động', t: 'green' }, REVOKED: { label: 'Đã thu hồi', t: 'red' },
};

/**
 * Signing keys on this phone. The enterprise administrator creates them here
 * once; staff signing on the same phone then use them. Chains pinned to dual
 * signing need a key per chain that the ledger activates before use.
 */
export default function Signing() {
  const { chainId } = useLocalSearchParams<{ chainId?: string }>();
  const { call, user } = useSession<Schemas['AuthUserDto']>();
  const { access } = useAccess();
  const org = user?.organizationId ?? '';
  const load = useLoad(async () => {
    const chains = (await call<Chain[]>('/supply-chains')).filter((c) => !chainId || c.id === chainId);
    const contexts = await Promise.all(chains.map((c) => call<Context>(`/supply-chains/${c.id}/signing-keys`).catch(() => null)));
    const enterprise = await call<{ items: { id: string; label: string; status: string }[] }>('/distribution/keys').catch(() => ({ items: [] }));
    const local = new Set([...(await listDeviceKeys('distribution', org)), ...(await Promise.all(chains.map((c) => listDeviceKeys(c.id, org)))).flat()].map((k) => k.id));
    return { chains, contexts, enterprise: enterprise.items, local };
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
        <Notice kind="info" title="Khóa riêng không rời điện thoại" body="Máy chủ chỉ nhận khóa công khai và bằng chứng sở hữu. Gỡ ứng dụng hoặc đổi máy thì phải tạo khóa mới." />
        {!admin && <Notice kind="warn" title="Chỉ tài khoản quản trị doanh nghiệp tạo được khóa" body="Nhờ quản trị đăng nhập ứng dụng trên điện thoại này để tạo khóa; sau đó bạn ký bằng khóa đó." />}
        {message && <Notice kind={message.kind} title={message.text} />}
        {load.loading && !data ? <Loading /> : load.error ? <Notice kind="error" title={load.error} /> : data && (
          <>
            <T size={18} weight="heavy">Khóa giao nhận của doanh nghiệp</T>
            <Card style={{ padding: 16, gap: 8 }}>
              {data.enterprise.length === 0 && <T c={color.muted}>Chưa có khóa.</T>}
              {data.enterprise.map((k) => (
                <View key={k.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T style={{ flex: 1 }}>{k.label}{data.local.has(k.id) ? ' · trên máy này' : ''}</T>
                  <Pill label={KEY_STATUS[k.status]?.label ?? k.status} t={KEY_STATUS[k.status]?.t ?? 'orange'} />
                </View>
              ))}
              {admin && (
                <Button label="Tạo khóa giao nhận trên máy này" icon="lock" loading={busy} disabled={busy} onPress={() => void register(async () => {
                  const key = await createDistributionKey(org, 'Khóa trên điện thoại');
                  return { path: '/distribution/keys', body: key, idempotencyKey: newIdempotencyKey() };
                })} />
              )}
            </Card>
            <T size={18} weight="heavy">Khóa ký kép theo chuỗi</T>
            {data.chains.map((c, i) => {
              const ctx = data.contexts[i];
              if (!ctx || ctx.handoverMode !== 'DUAL_SIGNED') return (
                <Card key={c.id} style={{ padding: 16, gap: 4 }}>
                  <T weight="heavy">{c.name}</T>
                  <T size={13} c={color.muted}>Chuỗi dùng khóa giao nhận của doanh nghiệp.</T>
                </Card>
              );
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
