import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../auth/session';
import { Button, Field, Header, Notice } from '../../components/staff/ui';
import { color } from '../../theme/staff';

const bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * Password change. An account created or reset by an administrator lands here
 * first; the API keeps this session and signs out the account's other devices.
 */
export default function StaffPassword() {
  const { call, reloadUser, signOut, user } = useSession<{ mustChangePassword?: boolean }>();
  const forced = !!user?.mustChangePassword;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (bytes(next) < 12 || bytes(next) > 72) return setError('Mật khẩu mới dài từ 12 ký tự, tối đa 72 byte.');
    if (next !== confirm) return setError('Hai lần nhập mật khẩu mới chưa khớp.');
    if (next === current) return setError('Mật khẩu mới phải khác mật khẩu hiện tại.');
    setBusy(true);
    setError(null);
    try {
      await call('/auth/change-password', { body: { currentPassword: current, newPassword: next } });
      await reloadUser();
      router.replace('/staff');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title="Đổi mật khẩu" back={!forced} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
          {forced && <Notice kind="warn" title="Đổi mật khẩu trước khi làm việc" body="Tài khoản do chủ doanh nghiệp cấp hoặc vừa được đặt lại mật khẩu." />}
          {error && <Notice kind="error" title={error} />}
          <Field label="Mật khẩu hiện tại" required secure autoCapitalize="none" autoComplete="current-password" value={current} onChangeText={setCurrent} />
          <Field label="Mật khẩu mới (tối thiểu 12 ký tự)" required secure autoCapitalize="none" autoComplete="new-password" value={next} onChangeText={setNext} />
          <Field label="Nhập lại mật khẩu mới" required secure autoCapitalize="none" autoComplete="new-password" value={confirm} onChangeText={setConfirm} />
          <Button label="Đổi mật khẩu" loading={busy} disabled={busy || !current || !next || !confirm} onPress={() => void submit()} />
          {forced && <Button label="Đăng xuất" kind="outline" disabled={busy} onPress={() => void signOut().then(() => router.replace('/staff/login'))} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
