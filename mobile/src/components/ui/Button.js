/**
 * Buttons (web components/ui/Button.tsx): `Button` (text, optional icons) and `IconButton`
 * (round / square icon-only), with the same variants, sizes and colours.
 */
import { forwardRef } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme';
import { ICON_STROKE, ICON_STROKE_ON_FILL, Icon } from '@/components/icons';
import { Press, T } from './primitives';
import { Spinner } from './Spinner';

const SIZES = {
  sm: { h: 32, px: 14, gap: 6, font: 14, icon: 16 },
  md: { h: 40, px: 20, gap: 8, font: 15, icon: 18 },
  lg: { h: 48, px: 24, gap: 8, font: 16, icon: 20 },
};

function variantColors(variant, c) {
  switch (variant) {
    case 'secondary':
      return { bg: c['surface-2'], fg: c.fg, pressed: c.line };
    case 'soft':
      return { bg: c['brand-soft'], fg: c['brand-ink'], pressed: c.selected };
    case 'outline':
      return { bg: 'transparent', fg: c['brand-ink'], pressed: c.hover, border: c['line-strong'] };
    case 'ghost':
      return { bg: 'transparent', fg: c.fg, pressed: c.hover };
    case 'danger':
      return { bg: c['danger-fill'], fg: '#ffffff', pressed: '#c7343a', filled: true };
    default:
      return { bg: c.brand, fg: c['on-brand'], pressed: c['brand-strong'], filled: true };
  }
}

export const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth,
    disabled,
    onPress,
    children,
    style,
    textStyle,
    accessibilityLabel,
  },
  ref,
) {
  const { c, shadow } = useTheme();
  const s = SIZES[size];
  const v = variantColors(variant, c);
  const stroke = v.filled ? ICON_STROKE_ON_FILL : ICON_STROKE;
  const off = disabled || loading;
  return (
    <Press
      ref={ref}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!off, busy: loading }}
      style={({ pressed }) => [
        {
          height: s.h,
          paddingHorizontal: s.px,
          gap: s.gap,
          borderRadius: 999,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: fullWidth ? 'stretch' : 'auto',
          backgroundColor: pressed ? v.pressed : v.bg,
          opacity: off ? 0.5 : 1,
        },
        v.border ? { borderWidth: 1, borderColor: v.border } : null,
        v.filled ? shadow.sm : null,
        style,
      ]}
      feedback={false}
    >
      {loading ? (
        <Spinner size={s.icon} color={v.fg} />
      ) : leftIcon ? (
        <Icon icon={leftIcon} size={s.icon} color={v.fg} strokeWidth={stroke} />
      ) : null}
      {children != null ? (
        <T
          numberOfLines={1}
          style={[
            { color: v.fg, fontSize: s.font, fontWeight: '600', lineHeight: s.font * 1.3 },
            textStyle,
          ]}
        >
          {children}
        </T>
      ) : null}
      {rightIcon && !loading ? (
        <Icon icon={rightIcon} size={s.icon} color={v.fg} strokeWidth={stroke} />
      ) : null}
    </Press>
  );
});

const ICON_SIZES = {
  xs: { box: 28, icon: 16 },
  sm: { box: 32, icon: 18 },
  md: { box: 40, icon: 22 },
  lg: { box: 48, icon: 24 },
  xl: { box: 64, icon: 28 },
};

function iconVariant(variant, c, active) {
  switch (variant) {
    case 'solid':
      return { bg: c['surface-2'], fg: c.fg, pressed: c.line };
    case 'brand':
      return { bg: c.brand, fg: c['on-brand'], pressed: c['brand-strong'], shadow: true };
    case 'danger':
      return { bg: c['danger-fill'], fg: '#ffffff', pressed: '#c7343a', shadow: true };
    case 'success':
      return { bg: c.success, fg: '#ffffff', pressed: '#15803d', shadow: true };
    case 'glass':
      return { bg: 'rgba(0,0,0,0.35)', fg: '#ffffff', pressed: 'rgba(0,0,0,0.5)' };
    default:
      return {
        bg: active ? c.hover : 'transparent',
        fg: active ? c.fg : c.muted,
        pressed: c.hover,
        pressedFg: c.fg,
      };
  }
}

export const IconButton = forwardRef(function IconButton(
  {
    icon,
    label,
    variant = 'ghost',
    size = 'md',
    active,
    loading,
    disabled,
    badge,
    shape = 'circle',
    color,
    strokeWidth,
    onPress,
    onLongPress,
    style,
    hitSlop,
  },
  ref,
) {
  const { c, shadow } = useTheme();
  const s =
    typeof size === 'number' ? { box: size, icon: Math.round(size * 0.55) } : ICON_SIZES[size];
  const v = iconVariant(variant, c, active);
  const off = disabled || loading;
  return (
    <Press
      ref={ref}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={off}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, selected: !!active }}
      feedback={false}
      style={({ pressed }) => [
        {
          width: s.box,
          height: s.box,
          borderRadius: shape === 'square' ? 16 : 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? v.pressed : v.bg,
          opacity: off ? 0.45 : 1,
        },
        v.shadow ? shadow.sm : null,
        style,
      ]}
    >
      {({ pressed }) => (
        <>
          {loading ? (
            <Spinner size={s.icon - 2} color={v.fg} />
          ) : (
            <Icon
              icon={icon}
              size={s.icon}
              color={color ?? (pressed && v.pressedFg ? v.pressedFg : v.fg)}
              strokeWidth={strokeWidth}
            />
          )}
          {badge ? (
            <View pointerEvents="none" style={{ position: 'absolute', top: -2, right: -2 }}>
              {badge}
            </View>
          ) : null}
        </>
      )}
    </Press>
  );
});
