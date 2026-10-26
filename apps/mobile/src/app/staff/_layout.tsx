import { Redirect, Stack, useSegments } from 'expo-router';
import { View } from 'react-native';
import { SessionProvider, useSession } from '../../auth/session';
import { Loading } from '../../components/ui';
import { color } from '../../theme/tokens';

/** Every staff screen except sign-in needs a session. */
function Gate() {
  const { status } = useSession();
  const segments = useSegments();
  const onLogin = segments.at(-1) === 'login';
  if (status === 'loading')
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: color.bg }}>
        <Loading label="Đang mở phiên làm việc…" />
      </View>
    );
  if (status === 'anonymous' && !onLogin) return <Redirect href="/staff/login" />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
      <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
    </Stack>
  );
}

export default function StaffLayout() {
  return (
    <SessionProvider audience="staff">
      <Gate />
    </SessionProvider>
  );
}
