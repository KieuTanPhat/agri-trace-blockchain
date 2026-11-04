import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorText } from '../../api/client';
import { useSession } from '../../auth/session';
import { Icon } from '../../components/staff/Icon';
import { Button, Field, Notice, T } from '../../components/staff/ui';
import { color, space } from '../../theme/staff';

/** Employees only: owners and platform accounts are refused like a wrong password. */
export default function StaffLogin() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn('/auth/staff/login', { email: email.trim(), password });
      router.replace('/staff');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.lg }}>
          <Image source={require('../../../assets/brand/logo-agritrace.webp')} style={{ width: 132, height: 74 }} contentFit="contain" accessibilityLabel="AgriTrace" />
          <View style={{ gap: 4 }}>
            <T size={24} weight="heavy">
              Đăng nhập nhân viên
            </T>
            <T size={14.5} c={color.muted}>
              Dùng email và mật khẩu chủ doanh nghiệp đã cấp cho bạn.
            </T>
          </View>
          <Field label="Email" icon="mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="username" textContentType="username" placeholder="ten@doanhnghiep.vn" />
          <Field label="Mật khẩu" icon="lock" value={password} onChangeText={setPassword} secure autoComplete="current-password" textContentType="password" placeholder="Nhập mật khẩu" onSubmitEditing={() => void submit()} />
          {error && <Notice kind="error" title={error} />}
          <Button label="Đăng nhập" onPress={() => void submit()} loading={busy} disabled={!email.trim() || !password} />
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
            <Icon name="info" size={16} color={color.muted} />
            <T size={13} c={color.muted} style={{ flex: 1 }}>
              Ứng dụng dành cho nhân viên hiện trường. Chủ doanh nghiệp quản lý trên AgriTrace Web. Quên mật khẩu thì liên hệ chủ doanh nghiệp để đặt lại.
            </T>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
