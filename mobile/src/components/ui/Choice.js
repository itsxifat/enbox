/**
 * Switch, Checkbox and RadioGroup (web components/ui/Choice.tsx) plus the Tabs control
 * (web Tabs.tsx: `underline` section tabs and `chips` filters).
 */
import { useEffect, useRef } from 'react';
import { Animated, ScrollView, View } from 'react-native';
import { Check, Minus } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { ICON_STROKE_BOLD, Icon } from '@/components/icons';
import { Badge } from './Badge';
import { Press, T } from './primitives';

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  style,
  accessibilityLabel,
}) {
  const { tw, c, shadow } = useTheme();
  const x = useRef(new Animated.Value(checked ? 18 : 2)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: checked ? 18 : 2, duration: 200, useNativeDriver: true }).start();
  }, [checked, x]);
  const control = (
    <Press
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      feedback={false}
      onPress={() => onChange(!checked)}
      style={[
        tw`h-6 w-10 justify-center rounded-full`,
        { backgroundColor: checked ? c.brand : c['line-strong'], opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <Animated.View
        style={[tw`size-5 rounded-full bg-white`, shadow.sm, { transform: [{ translateX: x }] }]}
      />
    </Press>
  );
  if (!label) return <View style={style}>{control}</View>;
  return (
    <Press
      feedback={false}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[tw`flex-row items-center justify-between gap-4 py-3`, style]}
    >
      <View style={tw`min-w-0 flex-1`}>
        <T style={tw`text-[15px]`}>{label}</T>
        {description ? (
          <T style={tw`mt-0.5 text-[13px] leading-snug text-muted`}>{description}</T>
        ) : null}
      </View>
      {control}
    </Press>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  indeterminate,
  disabled,
  round,
  style,
}) {
  const { tw, c } = useTheme();
  const on = checked || indeterminate;
  return (
    <Press
      feedback={false}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: indeterminate ? 'mixed' : checked, disabled }}
      onPress={() => onChange(!checked)}
      style={[tw`flex-row items-start gap-3`, disabled ? { opacity: 0.5 } : null, style]}
    >
      <View
        style={[
          tw`mt-0.5 size-5 items-center justify-center border-2`,
          round ? tw`rounded-full` : tw`rounded-md`,
          {
            borderColor: on ? c.brand : c['line-strong'],
            backgroundColor: on ? c.brand : c.surface,
          },
        ]}
      >
        {on ? (
          <Icon
            icon={indeterminate ? Minus : Check}
            size={14}
            strokeWidth={ICON_STROKE_BOLD}
            color={c['on-brand']}
          />
        ) : null}
      </View>
      {label || description ? (
        <View style={tw`min-w-0 flex-1`}>
          {label ? <T style={tw`text-[15px]`}>{label}</T> : null}
          {description ? <T style={tw`mt-0.5 text-[13px] text-muted`}>{description}</T> : null}
        </View>
      ) : null}
    </Press>
  );
}

/** A round selection mark (multi-select pickers, like WhatsApp's contact picker). */
export function CheckCircle({ checked, size = 22 }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        borderColor: checked ? c.brand : c['line-strong'],
        backgroundColor: checked ? c.brand : 'transparent',
      }}
    >
      {checked ? (
        <Icon icon={Check} size={size - 8} strokeWidth={ICON_STROKE_BOLD} color={c['on-brand']} />
      ) : null}
    </View>
  );
}

export function RadioGroup({ value, onChange, options, label, style }) {
  const { tw, c } = useTheme();
  return (
    <View style={style} accessibilityRole="radiogroup">
      {label ? <T style={tw`mb-2 text-sm font-medium`}>{label}</T> : null}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Press
            key={o.value}
            disabled={o.disabled}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled: o.disabled }}
            onPress={() => onChange(o.value)}
            style={[
              tw`-mx-2 flex-row items-start gap-3 rounded-xl px-2 py-2.5`,
              o.disabled ? { opacity: 0.45 } : null,
            ]}
          >
            <View
              style={[
                tw`mt-0.5 size-5 items-center justify-center rounded-full border-2`,
                { borderColor: selected ? c.brand : c['line-strong'] },
              ]}
            >
              {selected ? <View style={tw`size-2.5 rounded-full bg-brand`} /> : null}
            </View>
            <View style={tw`min-w-0 flex-1`}>
              <T style={tw`text-[15px]`}>{o.label}</T>
              {o.description ? (
                <T style={tw`mt-0.5 text-[13px] text-muted`}>{o.description}</T>
              ) : null}
            </View>
          </Press>
        );
      })}
    </View>
  );
}

export function Tabs({ value, onChange, items, variant = 'underline', style }) {
  const { tw, c } = useTheme();
  if (variant === 'chips') {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={tw`gap-2`}
        keyboardShouldPersistTaps="handled"
      >
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <Press
              key={item.value}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              disabled={item.disabled}
              onPress={() => onChange(item.value)}
              feedback={false}
              style={({ pressed }) => [
                tw`h-8 flex-row items-center justify-center gap-1.5 rounded-full px-3.5`,
                {
                  backgroundColor: selected ? c['brand-soft'] : pressed ? c.line : c['surface-2'],
                },
              ]}
            >
              <T
                style={[
                  tw`text-[14px] font-medium`,
                  { color: selected ? c['brand-ink'] : c.muted },
                ]}
              >
                {item.label}
              </T>
              {item.count ? (
                <Badge count={item.count} tone={selected ? 'brand' : 'muted'} size="sm" />
              ) : null}
            </Press>
          );
        })}
      </ScrollView>
    );
  }
  return (
    <View style={[tw`flex-row border-b border-line`, style]} accessibilityRole="tablist">
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <Press
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            disabled={item.disabled}
            onPress={() => onChange(item.value)}
            style={tw`relative h-11 flex-1 flex-row items-center justify-center gap-1.5 px-3`}
          >
            <T
              style={[tw`text-[14px] font-medium`, { color: selected ? c['brand-ink'] : c.muted }]}
            >
              {item.label}
            </T>
            {item.count ? (
              <Badge count={item.count} tone={selected ? 'brand' : 'muted'} size="sm" />
            ) : null}
            {selected ? (
              <View style={tw`absolute right-3 bottom-0 left-3 h-[3px] rounded-t-full bg-brand`} />
            ) : null}
          </Press>
        );
      })}
    </View>
  );
}
