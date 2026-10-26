import { Stack } from 'expo-router';
import { SessionProvider } from '../../auth/session';
import { color } from '../../theme/tokens';

export default function ConsumerLayout() {
  return (
    <SessionProvider audience="consumer">
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
        <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      </Stack>
    </SessionProvider>
  );
}
