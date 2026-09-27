/**
 * Anchored popup menus (web components/ui/Menu.tsx).
 *
 *   <DropdownMenu items={[...]} trigger={(p) => <IconButton {...p} icon={EllipsisVertical} label="Menu" />} />
 *   <Menu open anchor={{ x, y }} items={[...]} onClose={...} />   // context menus
 *
 * Items: `{ label, onSelect, icon?, danger?, disabled?, hint? }`, `'separator'`, or falsy (skipped).
 * The menu opens below its anchor (above when it wouldn't fit), aligned to its `end` edge by
 * default, and closes on outside taps and the back button.
 */
import { useCallback, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTheme } from '@/theme';
import { Icon } from '@/components/icons';
import { usePresence } from './Modal';
import { Portal, Press, T, useBackHandler } from './primitives';

const MARGIN = 8;

export function Menu({ open, onClose, anchor, items, align = 'start' }) {
  const { tw, c, shadow } = useTheme();
  const { width: vw, height: vh } = useWindowDimensions();
  const [size, setSize] = useState(null);
  const [mounted, progress] = usePresence(open, { enter: 180, exit: 120 });
  useBackHandler(() => {
    onClose();
    return true;
  }, open);
  if (!mounted || !anchor) return null;

  const entries = items.filter(Boolean);
  let top = 0;
  let left = 0;
  let fromBottom = false;
  if (size) {
    if (anchor.width !== undefined) {
      top = anchor.y + anchor.height + 4;
      left = align === 'end' ? anchor.x + anchor.width - size.width : anchor.x;
      if (top + size.height > vh - MARGIN && anchor.y - size.height - 4 > MARGIN) {
        top = anchor.y - size.height - 4;
        fromBottom = true;
      }
    } else {
      top = anchor.y;
      left = anchor.x;
      if (left + size.width > vw - MARGIN) left = anchor.x - size.width;
      if (top + size.height > vh - MARGIN) {
        top = anchor.y - size.height;
        fromBottom = true;
      }
    }
    left = Math.max(MARGIN, Math.min(left, vw - size.width - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - size.height - MARGIN));
  }
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  // Grows out of the anchor side (the web's transform-origin top/bottom).
  const originY = fromBottom ? -1 : 1;

  return (
    <Portal>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close menu"
      />
      <Animated.View
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (!size || size.width !== width || size.height !== height) setSize({ width, height });
        }}
        style={[
          tw`absolute rounded-2xl border border-line bg-elevated py-1.5`,
          shadow.elevated,
          { minWidth: 192, maxWidth: Math.min(320, vw - 16), top, left },
          size
            ? {
                opacity: progress,
                transform: [
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [originY * -4, 0],
                    }),
                  },
                  { scale },
                ],
              }
            : { opacity: 0 },
        ]}
        accessibilityRole="menu"
      >
        {entries.map((entry, idx) =>
          entry === 'separator' ? (
            <View key={`sep-${idx}`} style={tw`my-1.5 h-px bg-line`} />
          ) : (
            <Press
              key={idx}
              accessibilityRole="menuitem"
              disabled={entry.disabled}
              onPress={() => {
                onClose();
                entry.onSelect();
              }}
              style={[
                tw`flex-row items-center gap-3 px-4 py-2.5`,
                entry.disabled ? { opacity: 0.45 } : null,
              ]}
            >
              {entry.icon ? (
                <Icon icon={entry.icon} size={20} color={entry.danger ? c.danger : c.muted} />
              ) : null}
              <T
                numberOfLines={1}
                style={[tw`min-w-0 flex-1 text-[15px]`, entry.danger ? tw`text-danger` : null]}
              >
                {entry.label}
              </T>
              {entry.hint ? <T style={tw`text-xs text-subtle`}>{entry.hint}</T> : null}
            </Press>
          ),
        )}
      </Animated.View>
    </Portal>
  );
}

/** Measure a view in window coordinates (menu anchors). */
export function measureAnchor(ref) {
  return new Promise((resolve) => {
    const node = ref.current;
    if (!node?.measureInWindow) return resolve(null);
    node.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });
}

/** A trigger button + anchored Menu. `trigger(props)` gets `{ ref, onPress, active }`. */
export function DropdownMenu({ trigger, items, align = 'end' }) {
  const ref = useRef(null);
  const [anchor, setAnchor] = useState(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      {trigger({
        ref,
        active: open,
        onPress: async () => {
          const a = await measureAnchor(ref);
          if (a) setAnchor(a);
          setOpen((o) => !o);
        },
      })}
      <Menu open={open} onClose={close} anchor={anchor} items={items} align={align} />
    </>
  );
}
