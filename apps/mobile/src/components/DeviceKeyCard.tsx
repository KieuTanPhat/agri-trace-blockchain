import { useState } from 'react';
import { View } from 'react-native';
import { errorText, type Schemas } from '../api/client';
import { useSession } from '../auth/session';
import { useAccess } from '../lib/access';
import { ensureDeviceKey, resendDeviceKeyCode, verifyDeviceKeyCode, type DeviceKeyState } from '../lib/signing/device-key';
import { useLoad } from '../lib/useApi';
import { Button, Card, Field, Notice, T } from './ui';

/**
 * Personal signing key of this phone. It is created automatically; the member
 * only types the code emailed to the account address to turn it on.
 */
export function DeviceKeyCard({ quiet }: { quiet?: boolean }) {
  const { call, user } = useSession<Schemas['AuthUserDto']>();
  const { can, access } = useAccess();
  const signer = can('distribution.sign') && user?.organizationId ? { id: user.id, organizationId: user.organizationId } : null;
  const loaded = useLoad(() => (signer ? ensureDeviceKey(call, signer) : Promise.resolve(null)), [signer?.id, signer?.organizationId]);
  // Verify and resend update the shown state without another round trip.
  const [override, setKey] = useState<DeviceKeyState | null>(null);
  const key = override ?? loaded.data ?? null;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setError] = useState<string | null>(null);
  const error = failure ?? loaded.error;

  if (!access || !signer || (quiet && key?.state === 'active' && !error)) return null;

  async function verify() {
    if (!key || busy || !/^\d{6}$/.test(code)) return setError('Nhập đủ 6 chữ số trong email.');
    setBusy(true);
    setError(null);
    try {
      await verifyDeviceKeyCode(call, key.keyId, code);
      setCode('');
      setKey({ state: 'active', keyId: key.keyId });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!key || busy) return;
    setBusy(true);
    setError(null);
    try {
      setKey({ ...key, state: 'pending', ...(await resendDeviceKeyCode(call, key.keyId)) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: 16, gap: 10 }}>
      <T size={16} weight="heavy">Khóa ký của bạn trên điện thoại này</T>
      {error && <Notice kind="error" title={error} action={!key ? <Button label="Thử lại" onPress={() => void loaded.reload()} /> : undefined} />}
      {!key && !error && <T>Đang chuẩn bị khóa ký…</T>}
      {key?.state === 'active' && <Notice kind="success" title="Khóa ký đang hoạt động" body="Bạn ký bàn giao được trên điện thoại này." />}
      {key?.state === 'pending' && (
        <View style={{ gap: 10 }}>
          <T>Nhập mã 6 số đã gửi tới {key.email ?? 'email tài khoản'} để bật khóa ký. Không phải bạn thao tác thì đừng nhập mã và báo quản trị doanh nghiệp.</T>
          <Field label="Mã xác minh" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
          <Button label="Xác minh" loading={busy} disabled={busy || code.length !== 6} onPress={() => void verify()} />
          <Button label="Gửi lại mã" kind="outline" disabled={busy} onPress={() => void resend()} />
        </View>
      )}
    </Card>
  );
}
