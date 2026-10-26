import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorText } from '../../api/client';
import { useSession } from '../../auth/session';
import { Button, Field, IconButton, Notice, T } from '../../components/ui';
import { color } from '../../theme/tokens';

export default function Login() {
  const insets = useSafeAreaInsets();
  const { signIn } = useSession();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn('/auth/mobile/login', { phone: phone.replace(/\s+/g, ''), password });
      router.replace('/consumer/account');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 24, paddingBottom: 32, gap: 16 }} keyboardShouldPersistTaps="handled">
        <IconButton name="back" label="Quay lại" onPress={() => (router.canGoBack() ? router.back() : router.replace('/consumer'))} style={{ marginLeft: -10 }} />
        <Image source={require('../../../assets/brand/logo-agritrace.webp')} style={{ width: 170, height: 96, marginLeft: -8 }} contentFit="contain" accessibilityLabel="AgriTrace" />
        <View style={{ gap: 6 }}>
          <T size={32} weight="heavy">
            Chào mừng bạn!
          </T>
          <T size={16.5} c={color.inkSoft}>
            Đăng nhập để xem tài khoản và lịch sử của bạn.
          </T>
        </View>
        <Field label="Điện thoại" icon="phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" autoCorrect={false} placeholder="Nhập số điện thoại đăng nhập" />
        <Field label="Mật khẩu" icon="lock" value={password} onChangeText={setPassword} secure autoComplete="current-password" textContentType="password" placeholder="Nhập mật khẩu của bạn" onSubmitEditing={() => void submit()} />
        {error && <Notice kind="error" title={error} />}
        <Button label="Đăng nhập" onPress={() => void submit()} loading={busy} disabled={!phone.trim() || !password} style={{ marginTop: 6 }} />
        <Pressable accessibilityRole="link" onPress={() => router.push('/consumer/register?reset=1')} style={{ alignSelf: 'center', padding: 10 }}>
          <T size={16.5} weight="bold" c={color.blue}>
            Quên mật khẩu?
          </T>
        </Pressable>
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 24 }}>
          <T size={16.5} c={color.inkSoft}>
            Bạn chưa có tài khoản?{' '}
          </T>
          <Pressable accessibilityRole="link" onPress={() => router.push('/consumer/register')}>
            <T size={16.5} weight="heavy" c={color.blue}>
              Đăng ký
            </T>
          </Pressable>
        </View>
        <T size={13.5} c={color.muted} style={{ textAlign: 'center' }}>
          Tài khoản doanh nghiệp đăng nhập bằng email trên AgriTrace Web.
        </T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
