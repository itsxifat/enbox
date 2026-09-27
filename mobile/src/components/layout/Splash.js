import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoMark } from '@/components/icons';
import { Spinner, T } from '@/components/ui';
import { useTheme } from '@/theme';

/** Full-screen boot splash (resolving the stored session). */
export function Splash({ message }) {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(pop, {
      toValue: 1,
      duration: 260,
      easing: Easing.bezier(0.2, 0.9, 0.3, 1.4),
      useNativeDriver: true,
    }).start();
  }, [pop]);
  return (
    <View
      style={tw`flex-1 items-center justify-center gap-8 bg-surface`}
      accessibilityLabel="Loading Enbox"
    >
      <Animated.View
        style={{
          opacity: pop,
          transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }}
      >
        <LogoMark size={80} />
      </Animated.View>
      <View style={tw`h-6 flex-row items-center gap-2`}>
        {message ? (
          <>
            <Spinner size={16} />
            <T style={tw`text-sm text-muted`}>{message}</T>
          </>
        ) : null}
      </View>
      <T
        style={[
          tw`absolute text-xs font-semibold uppercase text-subtle`,
          { bottom: Math.max(24, insets.bottom), letterSpacing: 3.6 },
        ]}
      >
        Enbox
      </T>
    </View>
  );
}
