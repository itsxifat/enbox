import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { create } from 'zustand';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spinner, T } from '@/components/ui';
import { useConnection } from '@/lib/socket';
import { useTheme } from '@/theme';

/** Delay before showing "Connecting…" so quick reconnects don't flash a banner. */
const SHOW_AFTER_MS = 2_000;

/**
 * Global slim banner while the socket is down (web ConnectionBanner). It takes the status
 * bar area, so screens below it drop their own top inset (`useBanner`).
 */
export function ConnectionBanner() {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  const state = useConnection((s) => s.state);
  const down = state === 'connecting' || state === 'disconnected';
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!down) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [down]);
  useEffect(() => {
    useBanner.setState({ shown: show });
    return () => useBanner.setState({ shown: false });
  }, [show]);
  if (!show) return null;
  return (
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={[
        tw`flex-row items-center justify-center gap-2 bg-brand-soft px-4 pb-1.5`,
        { paddingTop: Math.max(6, insets.top) },
      ]}
    >
      <Spinner size={14} />
      <T style={tw`text-[13px] font-medium text-brand-ink`}>Connecting…</T>
    </View>
  );
}

/** Whether the banner is showing: it takes the status-bar area, so headers drop their inset. */
export const useBanner = create(() => ({ shown: false }));
