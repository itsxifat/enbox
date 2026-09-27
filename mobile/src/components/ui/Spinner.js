import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '@/theme';

/** Indeterminate ring spinner (the web's `animate-spin` SVG); `color` defaults to brand-ink. */
export function Spinner({ size = 20, color, style }) {
  const { c } = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const stroke = color ?? c['brand-ink'];
  return (
    <Animated.View
      style={[{ width: size, height: size, transform: [{ rotate }] }, style]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      <Svg viewBox="0 0 24 24" width={size} height={size} fill="none">
        <Circle cx="12" cy="12" r="9.5" stroke={stroke} strokeOpacity={0.2} strokeWidth="3" />
        <Path
          d="M21.5 12A9.5 9.5 0 0 0 12 2.5"
          stroke={stroke}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  );
}

/** Centered spinner filling its container (pane/page loading). */
export function PageSpinner({ style }) {
  const { tw } = useTheme();
  return (
    <View style={[tw`flex-1 items-center justify-center p-8`, style]}>
      <Spinner size={28} />
    </View>
  );
}

/** Pulsing placeholder block. */
export function Skeleton({ style, circle }) {
  const { tw } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[
        tw`bg-surface-2`,
        circle ? tw`rounded-full` : tw`rounded-md`,
        { opacity: pulse },
        style,
      ]}
    />
  );
}

const WIDTHS = ['40%', '50%', '33%', '60%', '40%', '50%'];

/** Placeholder rows matching ListItem (avatar + two lines). */
export function ListItemSkeleton({ count = 6 }) {
  const { tw } = useTheme();
  return (
    <View accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            tw`flex-row items-center gap-3 px-4 py-3`,
            { opacity: Math.max(0.25, 1 - i * 0.12) },
          ]}
        >
          <Skeleton circle style={tw`size-12`} />
          <View style={tw`min-w-0 flex-1 gap-2.5`}>
            <View style={tw`flex-row items-center justify-between gap-4`}>
              <Skeleton style={[tw`h-3.5`, { width: WIDTHS[i % WIDTHS.length] }]} />
              <Skeleton style={tw`h-3 w-9`} />
            </View>
            <Skeleton style={[tw`h-3`, { width: i % 2 ? '80%' : '60%' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}
