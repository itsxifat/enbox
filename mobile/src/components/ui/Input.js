/**
 * Form controls (web components/ui/Input.tsx, SearchInput.tsx): `Field` (label + control +
 * hint/error), `Input`, `Textarea` and the pill `SearchInput`.
 */
import { forwardRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { ArrowLeft, Search, X } from 'lucide-react-native';
import { useTheme, alpha } from '@/theme';
import { Icon } from '@/components/icons';
import { Press, T } from './primitives';

export function Field({ label, error, hint, aside, children, style }) {
  const { tw } = useTheme();
  return (
    <View style={[tw`gap-1.5`, style]}>
      {label || aside ? (
        <View style={tw`flex-row items-baseline justify-between gap-2`}>
          {label ? <T style={tw`text-sm font-medium`}>{label}</T> : <View />}
          {aside ? (
            typeof aside === 'string' || typeof aside === 'number' ? (
              <T style={tw`text-xs text-muted`}>{aside}</T>
            ) : (
              aside
            )
          ) : null}
        </View>
      ) : null}
      {children}
      {error ? (
        <T accessibilityRole="alert" style={tw`text-[13px] text-danger`}>
          {error}
        </T>
      ) : hint ? (
        typeof hint === 'string' ? (
          <T style={tw`text-[13px] text-muted`}>{hint}</T>
        ) : (
          hint
        )
      ) : null}
    </View>
  );
}

/**
 * - `outline` (default): bordered form field
 * - `filled`: borderless pill on `surface-2` (composers, inline search)
 */
function useControlStyle(variant, error, focused, multiline) {
  const { tw, c } = useTheme();
  if (variant === 'filled') {
    return [
      tw`rounded-3xl border border-transparent`,
      { backgroundColor: focused ? c.surface : c['surface-2'] },
      focused ? { boxShadow: `0px 0px 0px 2px ${alpha(error ? c.danger : c.brand, 0.3)}` } : null,
    ];
  }
  return [
    multiline ? tw`rounded-xl border` : tw`rounded-xl border`,
    tw`bg-surface`,
    {
      borderColor: error ? c.danger : focused ? c.brand : c['line-strong'],
    },
    focused ? { boxShadow: `0px 0px 0px 3px ${alpha(error ? c.danger : c.brand, 0.2)}` } : null,
  ];
}

export const Input = forwardRef(function Input(
  {
    label,
    error,
    hint,
    aside,
    leftIcon,
    rightSlot,
    prefix,
    variant = 'outline',
    style,
    inputStyle,
    containerStyle,
    onFocus,
    onBlur,
    editable = true,
    ...rest
  },
  ref,
) {
  const { tw, c } = useTheme();
  const [focused, setFocused] = useState(false);
  const control = useControlStyle(variant, !!error, focused, false);
  const padLeft = leftIcon ? 40 : prefix ? (prefix.length === 1 ? 32 : 48) : 14;
  const field = (
    <View style={[tw`relative flex-row items-center`, style]}>
      {leftIcon ? (
        <View pointerEvents="none" style={tw`absolute left-3.5 z-10`}>
          <Icon icon={leftIcon} size={18} color={c.subtle} />
        </View>
      ) : null}
      {prefix ? (
        <T pointerEvents="none" style={tw`absolute left-3.5 z-10 text-[15px] text-muted`}>
          {prefix}
        </T>
      ) : null}
      <TextInput
        ref={ref}
        editable={editable}
        placeholderTextColor={c.subtle}
        selectionColor={alpha(c.brand, 0.5)}
        cursorColor={c.brand}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          control,
          {
            flex: 1,
            height: 44,
            paddingLeft: padLeft,
            paddingRight: rightSlot ? 44 : 14,
            fontSize: 15,
            color: c.fg,
            opacity: editable ? 1 : 0.6,
          },
          inputStyle,
        ]}
        {...rest}
      />
      {rightSlot ? (
        <View style={tw`absolute right-1 flex-row items-center`}>{rightSlot}</View>
      ) : null}
    </View>
  );
  if (!label && !error && !hint && !aside) return <View style={containerStyle}>{field}</View>;
  return (
    <Field label={label} error={error} hint={hint} aside={aside} style={containerStyle}>
      {field}
    </Field>
  );
});

export const Textarea = forwardRef(function Textarea(
  {
    label,
    error,
    hint,
    aside,
    variant = 'outline',
    minRows = 3,
    maxRows = 6,
    style,
    containerStyle,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  const control = useControlStyle(variant, !!error, focused, true);
  const line = 20;
  const field = (
    <TextInput
      ref={ref}
      multiline
      textAlignVertical="top"
      placeholderTextColor={c.subtle}
      selectionColor={alpha(c.brand, 0.5)}
      cursorColor={c.brand}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        control,
        {
          minHeight: line * minRows + 22,
          maxHeight: line * maxRows + 22,
          paddingHorizontal: 14,
          paddingVertical: 10,
          fontSize: 15,
          lineHeight: line,
          color: c.fg,
        },
        style,
      ]}
      {...rest}
    />
  );
  if (!label && !error && !hint && !aside) return <View style={containerStyle}>{field}</View>;
  return (
    <Field label={label} error={error} hint={hint} aside={aside} style={containerStyle}>
      {field}
    </Field>
  );
});

/** Pill search field with clear button; `onBack` swaps the glass for a back arrow while active. */
export const SearchInput = forwardRef(function SearchInput(
  { value, onChange, onBack, placeholder = 'Search', style, autoFocus, onSubmitEditing, ...rest },
  ref,
) {
  const { tw, c } = useTheme();
  const [focused, setFocused] = useState(false);
  const active = value.length > 0;
  return (
    <View
      style={[
        tw`relative h-10 flex-row items-center rounded-full bg-surface-2`,
        focused ? { boxShadow: `0px 0px 0px 2px ${alpha(c.brand, 0.3)}` } : null,
        style,
      ]}
    >
      {onBack && active ? (
        <Press
          accessibilityLabel="Back"
          onPress={() => {
            onChange('');
            onBack();
          }}
          style={tw`absolute left-1.5 z-10 size-7 items-center justify-center rounded-full`}
        >
          <Icon icon={ArrowLeft} size={18} color={c['brand-ink']} />
        </Press>
      ) : (
        <View pointerEvents="none" style={tw`absolute left-3.5 z-10`}>
          <Icon icon={Search} size={18} color={focused ? c['brand-ink'] : c.subtle} />
        </View>
      )}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.subtle}
        selectionColor={alpha(c.brand, 0.5)}
        cursorColor={c.brand}
        autoFocus={autoFocus}
        returnKeyType="search"
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          height: '100%',
          paddingLeft: 40,
          paddingRight: 36,
          fontSize: 15,
          color: c.fg,
        }}
        {...rest}
      />
      {active ? (
        <Press
          accessibilityLabel="Clear search"
          onPress={() => onChange('')}
          style={tw`absolute right-1.5 size-7 items-center justify-center rounded-full`}
        >
          <Icon icon={X} size={16} color={c.muted} />
        </Press>
      ) : null}
    </View>
  );
});
