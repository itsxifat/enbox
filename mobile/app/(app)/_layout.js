/** Signed-in area (web AppShell): the connection banner above a stack of full-screen routes. */
import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ConnectionBanner } from '@/components/layout/ConnectionBanner';
import { useOnboarding } from '@/features/auth/onboarding';
import { requestNotificationPermission } from '@/lib/notify';
import { useTheme } from '@/theme';

export default function AppLayout() {
  const { c } = useTheme();
  const router = useRouter();
  const onboarding = useOnboarding((s) => s.pending);
  // Android 13+ asks once; message and call alerts need it while Enbox runs in the background.
  useEffect(() => {
    const t = setTimeout(() => void requestNotificationPermission(), 1500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!onboarding) return;
    useOnboarding.setState({ pending: false });
    const t = setTimeout(() => router.push('/welcome'), 0);
    return () => clearTimeout(t);
  }, [onboarding, router]);
  return (
    <View style={{ flex: 1, backgroundColor: c.app }}>
      <ConnectionBanner />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: c.surface },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ contentStyle: { backgroundColor: c.app } }} />
      </Stack>
    </View>
  );
}
