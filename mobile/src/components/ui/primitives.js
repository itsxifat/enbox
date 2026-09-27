/**
 * Primitives the rest of the kit builds on.
 *
 * - `T`       text with the web's body defaults (15px, `text-fg`, `leading-snug`).
 * - `Press`   a Pressable whose pressed state paints `bg-hover` (the web's hover/active
 *             feedback); pass `pressedStyle` to override, `feedback={false}` to disable.
 * - `Portal` / `PortalHost` render overlays (dialogs, sheets, menus, toasts) at the root of
 *             the app, in the same native window: keyboard handling and z-order behave the
 *             same on Android and in the web preview.
 * - `useBackHandler(fn, enabled)` Android back button: the most recently mounted handler
 *             runs first; return true to consume.
 */
import { forwardRef, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { create } from 'zustand';
import { useTheme } from '@/theme';

export const T = forwardRef(function T({ style, children, ...rest }, ref) {
  const { tw } = useTheme();
  return (
    <Text ref={ref} style={[tw`text-[15px] leading-snug text-fg`, style]} {...rest}>
      {children}
    </Text>
  );
});

export const Press = forwardRef(function Press(
  { style, pressedStyle, feedback = true, disabled, children, ...rest },
  ref,
) {
  const { tw } = useTheme();
  return (
    <Pressable
      ref={ref}
      disabled={disabled}
      style={(state) => {
        const base = typeof style === 'function' ? style(state) : style;
        if (!feedback || !state.pressed) return base;
        return [base, pressedStyle ?? tw`bg-hover`];
      }}
      {...rest}
    >
      {children}
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// Portals
// ---------------------------------------------------------------------------

const usePortals = create(() => ({ items: [] }));
let seq = 0;

export function Portal({ children }) {
  const key = useId();
  const order = useRef(null);
  if (order.current === null) order.current = ++seq;
  useLayoutEffect(() => {
    usePortals.setState((s) => {
      const others = s.items.filter((i) => i.key !== key);
      return {
        items: [...others, { key, order: order.current, node: children }].sort(
          (a, b) => a.order - b.order,
        ),
      };
    });
  });
  useLayoutEffect(
    () => () => usePortals.setState((s) => ({ items: s.items.filter((i) => i.key !== key) })),
    [key],
  );
  return null;
}

export function PortalHost() {
  const items = usePortals((s) => s.items);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {items.map((i) => (
        <View key={i.key} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {i.node}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Back button
// ---------------------------------------------------------------------------

export function useBackHandler(fn, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => !!ref.current());
    return () => sub.remove();
  }, [enabled]);
}

/** Tiny `cn()` for style arrays: drops falsy entries. */
export function sx(...styles) {
  return styles.flat().filter(Boolean);
}
