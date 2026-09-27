/**
 * Controls the web gets from CSS / native inputs:
 *
 * - `Gradient`  a linear-gradient background layer (profile headers, call scrims)
 * - `Segmented` the rounded pill of options (bubble style, reduce motion, scope)
 * - `Slider`    `<input type="range">` (wallpaper dim / blur)
 */
import { useId, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/theme';
import { Press, T } from './primitives';

const DIRECTIONS = {
  diagonal: { x1: '0', y1: '0', x2: '1', y2: '1' },
  down: { x1: '0', y1: '0', x2: '0', y2: '1' },
  up: { x1: '0', y1: '1', x2: '0', y2: '0' },
  right: { x1: '0', y1: '0', x2: '1', y2: '0' },
};

/**
 * `stops` = [[offset 0..1, color, opacity?], …] (or `from` / `to`); `direction` is diagonal
 * (the web's 135deg), down, up or right.
 */
export function Gradient({
  from,
  to,
  stops,
  direction = 'diagonal',
  style,
  children,
  pointerEvents,
}) {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const list = stops ?? [
    [0, from],
    [1, to],
  ];
  return (
    <View style={style} pointerEvents={pointerEvents}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} {...DIRECTIONS[direction]}>
            {list.map(([offset, color, opacity = 1], i) => (
              <Stop key={i} offset={String(offset)} stopColor={color} stopOpacity={opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}

/** An elliptical radial gradient layer (`radial-gradient(rx ry at cx cy, …)`), fractions of the box. */
export function RadialLayer({ cx = 0.5, cy = 0, rx = 1.2, ry = 0.8, stops, style }) {
  const id = `r${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg
      style={[StyleSheet.absoluteFill, style]}
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      pointerEvents="none"
    >
      <Defs>
        <RadialGradient
          id={id}
          cx={cx * 100}
          cy={cy * 100}
          fx={cx * 100}
          fy={cy * 100}
          rx={rx * 100}
          ry={ry * 100}
          gradientUnits="userSpaceOnUse"
        >
          {stops.map(([offset, color, opacity = 1], i) => (
            <Stop key={i} offset={String(offset)} stopColor={color} stopOpacity={opacity} />
          ))}
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
    </Svg>
  );
}

export function Segmented({ value, onChange, options, style, label }) {
  const { tw, c, shadow } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[tw`flex-row rounded-full bg-surface-2 p-1`, style]}
    >
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <Press
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(o.value)}
            feedback={false}
            style={[
              tw`h-9 min-w-0 flex-1 items-center justify-center rounded-full px-2`,
              selected ? [{ backgroundColor: c.surface }, shadow.sm] : null,
            ]}
          >
            {typeof o.label === 'string' ? (
              <T
                numberOfLines={1}
                style={[
                  tw`text-[14px] font-medium`,
                  { color: selected ? c.fg : c.muted },
                  o.labelStyle,
                ]}
              >
                {o.label}
              </T>
            ) : (
              o.label
            )}
          </Press>
        );
      })}
    </View>
  );
}

const THUMB = 20;

/** A horizontal range slider: tap or drag anywhere on the track. */
export function Slider({ value, min = 0, max, step = 1, onChange, disabled, style, label }) {
  const { c, shadow } = useTheme();
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  const origin = useRef(0);
  const frac = max > min ? (value - min) / (max - min) : 0;

  const fromX = (pageX) => {
    if (!width) return;
    const x = Math.max(0, Math.min(width, pageX - origin.current));
    const raw = min + (x / width) * (max - min);
    const next = Math.max(min, Math.min(max, Math.round(raw / step) * step));
    if (next !== value) onChange(next);
  };

  return (
    <View
      ref={ref}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (disabled) return;
        const d = e.nativeEvent.actionName === 'increment' ? step : -step;
        onChange(Math.max(min, Math.min(max, value + d)));
      }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        const pageX = e.nativeEvent.pageX;
        const locationX = e.nativeEvent.locationX;
        // pageX of the track's left edge (locationX can be relative to the thumb).
        origin.current = pageX - locationX;
        ref.current?.measureInWindow?.((x) => {
          origin.current = x;
          fromX(pageX);
        });
        fromX(pageX);
      }}
      onResponderMove={(e) => fromX(e.nativeEvent.pageX)}
      style={[{ height: 28, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }, style]}
    >
      <View
        pointerEvents="none"
        style={{ height: 6, borderRadius: 3, backgroundColor: c['line-strong'] }}
      >
        <View
          style={{
            width: `${frac * 100}%`,
            height: 6,
            borderRadius: 3,
            backgroundColor: c.brand,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: Math.max(0, frac * width - THUMB / 2),
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB,
            backgroundColor: c.brand,
            borderWidth: 3,
            borderColor: c.surface,
          },
          shadow.sm,
        ]}
      />
    </View>
  );
}
