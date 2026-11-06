import { Image } from 'expo-image';
import { BrandLogo } from '../../components/BrandLogo';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorText } from '../../api/client';
import { useSession } from '../../auth/session';
import { Button, Card, Field, Notice, T } from '../../components/staff/ui';

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
    <SafeAreaView style={{ flex: 1, backgroundColor: '#eff8ec', overflow: 'hidden' }}>
      <Image
        source={require('../../../assets/images/hero-rice-terraces.jpg')}
        style={{ position: 'absolute', left: -40, right: -40, bottom: -36, height: 300, opacity: 0.24 }}
        contentFit="cover"
        accessibilityElementsHidden
      />
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 230, backgroundColor: 'rgba(237, 248, 231, 0.58)' }}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 104, gap: 22 }}
        >
          <View style={{ alignItems: 'center', gap: 5 }}>
            <BrandLogo variant="staff" maxWidth={288} />
            <T size={25} weight="heavy" style={{ textAlign: 'center', flexShrink: 1 }}>
              Đăng nhập nhân viên
            </T>
          </View>
          <Card style={{ padding: 20, gap: 16, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.94)', borderColor: 'rgba(255,255,255,0.96)' }}>
            <Field label="Email" icon="mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="username" textContentType="username" placeholder="ten@doanhnghiep.vn" />
            <Field label="Mật khẩu" icon="lock" value={password} onChangeText={setPassword} secure autoComplete="current-password" textContentType="password" placeholder="Nhập mật khẩu" onSubmitEditing={() => void submit()} />
            {error && <Notice kind="error" title={error} />}
            <Button label="Đăng nhập" onPress={() => void submit()} loading={busy} disabled={!email.trim() || !password} />
            <Pressable accessibilityRole="link" accessibilityLabel="Quên mật khẩu?" disabled={busy} onPress={() => router.push('/staff/forgot-password')} style={{alignSelf:'center',padding:10,minHeight:44,justifyContent:'center'}}>
              <T size={14} weight="bold" c="#176540">Quên mật khẩu?</T>
            </Pressable>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
