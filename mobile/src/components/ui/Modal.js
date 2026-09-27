/**
 * Dialogs (web components/ui/Modal.tsx, features/chats/ActionSheet.tsx):
 *
 * - `Modal`       bottom sheet on phones (drag handle, slide-up) or, with
 *                 `sheetOnMobile={false}`, a centered card (confirm dialogs). Backdrop tap and the
 *                 Android back button close it when `dismissible`. Lifts above the keyboard.
 * - `ActionSheet` touch action list (long-press menus) in a bottom sheet.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, X } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Icon } from '@/components/icons';
import { IconButton } from './Button';
import { Portal, Press, T, useBackHandler } from './primitives';

/** Mount/unmount with an exit animation: returns [rendered, progress 0→1]. */
export function usePresence(open, { enter = 240, exit = 180 } = {}) {
  const [mounted, setMounted] = useState(open);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: enter,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: exit,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => finished && setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return [mounted, progress];
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  hideClose,
  sheetOnMobile = true,
  scroll = true,
  bodyStyle,
  panelStyle,
  maxWidth,
}) {
  const { tw, c, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [mounted, progress] = usePresence(open);
  useBackHandler(() => {
    if (dismissible) onClose?.();
    return true;
  }, open);
  if (!mounted) return null;

  const sheet = sheetOnMobile && width < 640;
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [height * 0.6, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });

  const Body = scroll ? ScrollView : View;
  const panel = (
    <Animated.View
      style={[
        tw`w-full overflow-hidden bg-elevated`,
        shadow.elevated,
        sheet
          ? [tw`rounded-t-3xl`, { maxHeight: height * 0.92, paddingBottom: insets.bottom }]
          : [
              tw`rounded-3xl`,
              { maxWidth: maxWidth ?? (sheetOnMobile ? 448 : 384), maxHeight: height * 0.92 - 32 },
            ],
        sheet ? { transform: [{ translateY }] } : { opacity: progress, transform: [{ scale }] },
        panelStyle,
      ]}
    >
      {sheet ? <View style={tw`mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong`} /> : null}
      {title || !hideClose ? (
        <View style={tw`flex-row items-start gap-3 px-6 pt-5 pb-2`}>
          <View style={tw`min-w-0 flex-1`}>
            {title ? (
              typeof title === 'string' ? (
                <T style={tw`text-lg font-semibold leading-tight`}>{title}</T>
              ) : (
                title
              )
            ) : null}
            {description ? (
              typeof description === 'string' ? (
                <T style={tw`mt-1.5 text-sm text-muted`}>{description}</T>
              ) : (
                <View style={tw`mt-1.5`}>{description}</View>
              )
            ) : null}
          </View>
          {!hideClose ? (
            <IconButton
              icon={X}
              label="Close"
              size="sm"
              onPress={onClose}
              style={tw`-mt-1 -mr-2`}
            />
          ) : null}
        </View>
      ) : null}
      <Body
        style={scroll ? tw`shrink` : tw`shrink`}
        contentContainerStyle={scroll ? [tw`px-6 py-3`, bodyStyle] : undefined}
        keyboardShouldPersistTaps="handled"
      >
        {scroll ? children : <View style={[tw`px-6 py-3`, bodyStyle]}>{children}</View>}
      </Body>
      {footer ? (
        <View style={tw`flex-row flex-wrap items-center justify-end gap-2 px-6 pt-2 pb-5`}>
          {footer}
        </View>
      ) : null}
    </Animated.View>
  );

  return (
    <Portal>
      <KeyboardAvoidingView
        behavior="padding"
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
      >
        <View
          style={[
            StyleSheet.absoluteFill,
            sheet
              ? tw`items-center justify-end`
              : [tw`items-center justify-center`, { padding: 16 }],
          ]}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay, opacity: progress }]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityLabel="Close"
              onPress={dismissible ? onClose : undefined}
            />
          </Animated.View>
          {panel}
        </View>
      </KeyboardAvoidingView>
    </Portal>
  );
}

/** Touch action list (long-press menus): a bottom sheet of rows. */
export function ActionSheet({ open, onClose, title, header, items }) {
  const { tw, c } = useTheme();
  const entries = items.filter(Boolean);
  return (
    <Modal open={open} onClose={onClose} title={title} hideClose bodyStyle={tw`px-0 py-2`}>
      {header ? <View style={tw`px-4 pb-2`}>{header}</View> : null}
      {entries.map((entry, i) =>
        entry === 'separator' ? (
          <View key={`sep-${i}`} style={tw`my-1 h-px bg-line`} />
        ) : (
          <Press
            key={i}
            accessibilityRole="menuitem"
            disabled={entry.disabled}
            onPress={() => {
              onClose();
              entry.onSelect();
            }}
            style={[
              tw`flex-row items-center gap-4 px-6 py-3`,
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
    </Modal>
  );
}

/**
 * Full-screen panel sliding in from the right (web `Sheet` on phones): header with a back
 * arrow, the title and actions; the Android back button closes it.
 */
export function Sheet({ open, onClose, title, actions, children, scroll = true, bodyStyle }) {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [mounted, progress] = usePresence(open);
  useBackHandler(() => {
    onClose?.();
    return true;
  }, open);
  if (!mounted) return null;
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0] });
  const Body = scroll ? ScrollView : View;
  return (
    <Portal>
      <Animated.View
        style={[StyleSheet.absoluteFill, tw`bg-surface`, { transform: [{ translateX }] }]}
      >
        {title !== undefined ? (
          <View
            style={[
              tw`h-16 flex-row items-center gap-2 bg-surface px-2`,
              { marginTop: insets.top, height: 64 },
            ]}
          >
            <IconButton icon={ArrowLeft} label="Close" onPress={onClose} />
            {typeof title === 'string' ? (
              <T numberOfLines={1} style={tw`min-w-0 flex-1 text-[17px] font-semibold`}>
                {title}
              </T>
            ) : (
              <View style={tw`min-w-0 flex-1`}>{title}</View>
            )}
            {actions}
          </View>
        ) : null}
        <Body
          style={tw`flex-1`}
          contentContainerStyle={
            scroll ? [{ paddingBottom: insets.bottom + 16 }, bodyStyle] : undefined
          }
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </Body>
      </Animated.View>
    </Portal>
  );
}
