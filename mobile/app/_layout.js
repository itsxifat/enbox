/**
 * Root of the route tree (the web client's main.tsx + RootLayout + guards):
 * boot (storage → theme → realtime → auth), app-wide providers, global hosts (toasts,
 * dialogs, overlays, the call UI) and the auth gate — `(auth)` screens while anonymous,
 * `(app)` screens while signed in, the splash while booting.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from '@react-navigation/native';
import { bootApp } from '@/lib/boot';
import { Splash } from '@/components/layout/Splash';
import { DialogHost, PortalHost, Toaster } from '@/components/ui';
import { CallHost } from '@/features/calls/CallHost';
import { ProfileHost } from '@/features/profile/ProfileHost';
import { useBus } from '@/hooks/useBus';
import { reportUserInput } from '@/lib/activity';
import { useAuth } from '@/stores/auth';
import { ThemeProvider, useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void bootApp().finally(() => {
      setReady(true);
      void SplashScreen.hideAsync().catch(() => undefined);
    });
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <ThemeProvider>{ready ? <Root /> : <Splash />}</ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const { c, dark } = useTheme();
  const status = useAuth((s) => s.status);
  const bootError = useAuth((s) => s.bootError);
  const router = useRouter();
  useBus('navigate', ({ to, replace }) => {
    if (replace) router.replace(to);
    else router.push(to);
  });
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.app).catch(() => undefined);
  }, [c.app]);

  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      background: c.app,
      card: c.surface,
      text: c.fg,
      border: c.line,
      primary: c.brand,
    },
  };

  if (status === 'booting') return <Splash message={bootError} />;
  const authed = status === 'authenticated';
  return (
    <NavigationThemeProvider value={navTheme}>
      <View style={{ flex: 1, backgroundColor: c.app }} onTouchStart={reportUserInput}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.app } }}>
          <Stack.Protected guard={authed}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={!authed}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
        {authed ? <ProfileHost /> : null}
        {authed ? <CallHost /> : null}
        <PortalHost />
        <Toaster />
        <DialogHost />
      </View>
    </NavigationThemeProvider>
  );
}
