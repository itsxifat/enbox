/**
 * Global feedback hosts, mounted once at the root (web components/ui/Toaster.tsx,
 * DialogHost.tsx, EmptyState.tsx):
 *
 * - `Toaster`    the `toast.*` stack (top center, slides down)
 * - `DialogHost` the promise-based `confirm()` / `choose()` dialogs
 * - `EmptyState` icon + title + description + actions block
 */
import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react-native';
import { useUi } from '@/stores/ui';
import { useTheme } from '@/theme';
import { Icon } from '@/components/icons';
import { Button } from './Button';
import { Modal } from './Modal';
import { Portal, Press, T } from './primitives';

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info };
const ACTION_MIN_MS = 10_000;

function ToastView({ t }) {
  const { tw, c, shadow } = useTheme();
  const dismiss = useUi((s) => s.dismissToast);
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(y, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [y]);
  const duration = t.duration && t.action ? Math.max(t.duration, ACTION_MIN_MS) : t.duration;
  useEffect(() => {
    if (!duration) return;
    const id = setTimeout(() => dismiss(t.id), duration);
    return () => clearTimeout(id);
  }, [t.id, duration, dismiss]);
  const color = t.kind === 'success' ? c.success : t.kind === 'error' ? c.danger : c['brand-ink'];
  return (
    <Animated.View
      accessibilityRole={t.kind === 'error' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
      style={[
        tw`w-full flex-row items-start gap-3 rounded-2xl border border-line bg-elevated px-4 py-3`,
        shadow.elevated,
        {
          maxWidth: 448,
          opacity: y,
          transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        },
      ]}
    >
      <Icon icon={ICONS[t.kind]} size={20} color={color} style={{ marginTop: 1 }} />
      <View style={tw`min-w-0 flex-1`}>
        <T style={tw`text-[14px] font-medium leading-snug`}>{t.message}</T>
        {t.description ? (
          <T style={tw`mt-0.5 text-[13px] leading-snug text-muted`}>{t.description}</T>
        ) : null}
      </View>
      {t.action ? (
        <Press
          style={tw`rounded-full px-2 py-0.5`}
          onPress={() => {
            t.action?.onClick();
            dismiss(t.id);
          }}
        >
          <T style={tw`text-[14px] font-semibold text-brand-ink`}>{t.action.label}</T>
        </Press>
      ) : null}
      <Press
        accessibilityLabel="Dismiss"
        onPress={() => dismiss(t.id)}
        style={tw`-mr-1 size-6 items-center justify-center rounded-full`}
      >
        <Icon icon={X} size={16} color={c.subtle} />
      </Press>
    </Animated.View>
  );
}

export function Toaster() {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  const toasts = useUi((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <Portal>
      <View
        pointerEvents="box-none"
        style={[
          tw`absolute inset-x-0 top-0 items-center gap-2 px-3`,
          { paddingTop: Math.max(12, insets.top) },
        ]}
      >
        {toasts.map((t) => (
          <ToastView key={t.id} t={t} />
        ))}
      </View>
    </Portal>
  );
}

export function DialogHost() {
  const { tw } = useTheme();
  const dialog = useUi((s) => s.dialogs[0]);
  const close = useUi((s) => s.closeDialog);
  if (!dialog) return null;
  const cancel = () => close(dialog.id, null);

  if (dialog.options?.length) {
    return (
      <Modal
        key={dialog.id}
        open
        onClose={cancel}
        title={dialog.title}
        description={dialog.message}
        hideClose
        sheetOnMobile={false}
      >
        <View style={tw`-mx-2 pb-3`}>
          {dialog.options.map((o) => (
            <Press
              key={o.value}
              onPress={() => close(dialog.id, o.value)}
              style={tw`rounded-xl px-3 py-2.5`}
            >
              <T
                style={[
                  tw`text-right text-[15px] font-medium`,
                  o.danger ? tw`text-danger` : tw`text-brand-ink`,
                ]}
              >
                {o.label}
              </T>
            </Press>
          ))}
          <Press onPress={cancel} style={tw`rounded-xl px-3 py-2.5`}>
            <T style={tw`text-right text-[15px] font-medium text-muted`}>{dialog.cancelLabel}</T>
          </Press>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      key={dialog.id}
      open
      onClose={cancel}
      title={dialog.title}
      hideClose
      sheetOnMobile={false}
      footer={
        <>
          <Button variant="ghost" onPress={cancel}>
            {dialog.cancelLabel}
          </Button>
          <Button
            variant={dialog.danger ? 'danger' : 'primary'}
            onPress={() => close(dialog.id, 'confirm')}
          >
            {dialog.confirmLabel}
          </Button>
        </>
      }
    >
      {dialog.message ? <T style={tw`text-[15px] text-muted`}>{dialog.message}</T> : null}
    </Modal>
  );
}

export function EmptyState({ icon, title, description, action, compact, style }) {
  const { tw, c } = useTheme();
  return (
    <View
      style={[
        tw`items-center justify-center`,
        compact ? tw`gap-2 px-6 py-8` : tw`gap-3 px-8 py-14`,
        style,
      ]}
    >
      {icon ? (
        <View
          style={[
            tw`mb-1 items-center justify-center rounded-full bg-brand-soft`,
            compact ? tw`size-12` : tw`size-16`,
          ]}
        >
          <Icon
            icon={icon}
            size={compact ? 22 : 28}
            strokeWidth={1.75}
            scale
            color={c['brand-ink']}
          />
        </View>
      ) : null}
      <T style={[tw`text-center font-semibold`, compact ? tw`text-[15px]` : tw`text-lg`]}>
        {title}
      </T>
      {description ? (
        <T style={[tw`text-center text-sm text-muted`, { maxWidth: 384, lineHeight: 22.75 }]}>
          {description}
        </T>
      ) : null}
      {action ? (
        <View style={tw`mt-2 flex-row flex-wrap items-center justify-center gap-2`}>{action}</View>
      ) : null}
    </View>
  );
}
