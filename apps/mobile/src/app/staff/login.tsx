import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { errorText } from '../../api/client';
import { useSession } from '../../auth/session';
import { Button, Field, Notice, T } from '../../components/ui';
import { color } from '../../theme/tokens';

export default function StaffLogin() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
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
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ height: 240, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' }}>
          <Image source={require('../../../assets/images/role-farm.jpg')} style={{ position: 'absolute', width: '100%', height: '100%' }} contentFit="cover" />
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(20,110,50,0.55)' } as never} />
          <View style={{ position: 'absolute', left: 24, right: 24, bottom: 22, gap: 6 }}>
            <View style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: color.orange }}>
              <T size={13} weight="heavy">
                Dành cho nhân viên
              </T>
            </View>
            <T size={28} weight="heavy" c="#fff">
              AgriTrace Hiện trường
            </T>
          </View>
        </View>
        <View style={{ padding: 28, gap: 16 }}>
          <T size={16} c={color.inkSoft}>
            Dùng tài khoản doanh nghiệp đã được cấp trên AgriTrace.
          </T>
          <Field label="Email" icon="mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="username" textContentType="username" placeholder="ten@doanhnghiep.vn" />
          <Field label="Mật khẩu" icon="lock" value={password} onChangeText={setPassword} secure autoComplete="current-password" textContentType="password" placeholder="Nhập mật khẩu" onSubmitEditing={() => void submit()} />
          {error && <Notice kind="error" title={error} />}
          <Button label="Đăng nhập" onPress={() => void submit()} loading={busy} disabled={!email.trim() || !password} style={{ marginTop: 6 }} />
          <T size={14.5} c={color.muted} style={{ textAlign: 'center' }}>
            Quên mật khẩu? Liên hệ quản trị doanh nghiệp.
          </T>
          <Image source={require('../../../assets/brand/logo-agritrace.webp')} style={{ width: 140, height: 79, alignSelf: 'center', marginTop: 8 }} contentFit="contain" accessibilityLabel="AgriTrace" />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
