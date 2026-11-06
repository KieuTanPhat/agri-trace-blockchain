import { Platform } from 'react-native';
import type { Schemas } from '../api/client';
import { useSession } from '../auth/session';
import { useAccess } from '../lib/access';
import { ensureDeviceKey } from '../lib/signing/device-key';
import { useLoad } from '../lib/useApi';
import { Button, Card, Notice, T } from './staff/ui';

/**
 * Personal signing key of this phone. It is created and registered
 * automatically and signs right away.
 */
export function DeviceKeyCard({ quiet }: { quiet?: boolean }) {
  const { call, user } = useSession<Schemas['AuthUserDto']>();
  const { can, access } = useAccess();
  const signer = can('distribution.sign') && user?.organizationId ? { id: user.id, organizationId: user.organizationId } : null;
  const loaded = useLoad(() => (signer && Platform.OS !== 'web' ? ensureDeviceKey(call, signer) : Promise.resolve(null)), [signer?.id, signer?.organizationId]);
  const key = loaded.data ?? null;
  const error = loaded.error;

  if (!access || !signer || (quiet && key && !error)) return null;
  // Keys live in the phone's secure store; a browser preview cannot hold one.
  if (Platform.OS === 'web')
    return quiet ? null : <Notice kind="info" title="Khóa ký chỉ có trên điện thoại" body="Mở ứng dụng trên điện thoại để tạo khóa và ký bàn giao." />;

  return (
    <Card style={{ padding: 16, gap: 10 }}>
      <T size={16} weight="heavy">Khóa ký của bạn trên điện thoại này</T>
      {error && <Notice kind="error" title={error} action={<Button label="Thử lại" onPress={() => void loaded.reload()} />} />}
      {!key && !error && <T>Đang chuẩn bị khóa ký…</T>}
      {key && <Notice kind="success" title="Khóa ký đang hoạt động" body="Bạn ký bàn giao được trên điện thoại này." />}
    </Card>
  );
}
