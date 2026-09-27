/**
 * Building blocks of the dark call surfaces (web features/calls/ui: CallButton, CallAvatar,
 * VideoView, hooks, CALL_BG).
 */
import { forwardRef, useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, View } from 'react-native';
import { UsersRound } from 'lucide-react-native';
import { formatDuration } from '@enbox/shared';
import { ICON_STROKE_ON_FILL, Icon } from '@/components/icons';
import { Avatar, Gradient, Press, RadialLayer, T } from '@/components/ui';
import { RTCView, isNativeWebRTC } from '@/lib/webrtc';

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

/** `bg-[#0d0c17] bg-[radial-gradient(120%_80%_at_50%_0%,#2a2168_0%,#15122b_45%,#0d0c17_100%)]` */
export function CallBackground() {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0d0c17' }]} pointerEvents="none">
      <RadialLayer
        cx={0.5}
        cy={0}
        rx={1.2}
        ry={0.8}
        stops={[
          [0, '#2a2168'],
          [0.45, '#15122b'],
          [1, '#0d0c17'],
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

const SIZES = {
  md: { box: 48, wide: 64, icon: 22 },
  lg: { box: 56, wide: 72, icon: 24 },
  xl: { box: 64, wide: 80, icon: 28 },
};

const TONES = {
  glass: { bg: 'rgba(255,255,255,0.14)', pressed: 'rgba(255,255,255,0.24)', fg: '#ffffff' },
  ghost: { bg: 'transparent', pressed: 'rgba(255,255,255,0.1)', fg: '#ffffff' },
  light: { bg: '#ffffff', pressed: 'rgba(255,255,255,0.9)', fg: '#15141c' },
  danger: { bg: '#ef4444', pressed: '#dc2626', fg: '#ffffff', shadow: 'rgba(127,29,29,0.3)' },
  success: { bg: '#22c55e', pressed: '#16a34a', fg: '#ffffff', shadow: 'rgba(20,83,45,0.3)' },
};

/** Round call control (mute, camera, end…). Always on the dark call surface. */
export const CallButton = forwardRef(function CallButton(
  {
    icon,
    label,
    caption,
    tone = 'glass',
    size = 'lg',
    wide,
    pressed,
    disabled,
    onPress,
    style,
    animatedStyle,
  },
  ref,
) {
  const s = SIZES[size];
  const t = TONES[tone];
  const button = (
    <Animated.View style={animatedStyle}>
      <Press
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled, selected: pressed }}
        disabled={disabled}
        onPress={onPress}
        feedback={false}
        style={({ pressed: down }) => [
          {
            width: wide ? s.wide : s.box,
            height: s.box,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: down ? t.pressed : t.bg,
            opacity: disabled ? 0.4 : 1,
            transform: [{ scale: down ? 0.95 : 1 }],
          },
          t.shadow ? { boxShadow: `0px 10px 15px -3px ${t.shadow}` } : null,
          !caption ? style : null,
        ]}
      >
        <Icon icon={icon} size={s.icon} color={t.fg} strokeWidth={ICON_STROKE_ON_FILL} />
      </Press>
    </Animated.View>
  );
  if (!caption) return button;
  return (
    <View style={[{ alignItems: 'center', gap: 8 }, style]}>
      {button}
      <T style={{ fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.8)' }}>{caption}</T>
    </View>
  );
});

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

/** Avatar for the dark call surfaces: group chats without a photo get a violet gradient icon. */
export function CallAvatar({ src, name, seed, group, size, style }) {
  if (group && !src) {
    return (
      <Gradient
        from="#a78bfa"
        to="#6d28d9"
        style={[
          {
            width: size,
            height: size,
            borderRadius: size,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          },
          style,
        ]}
      >
        <Icon
          icon={UsersRound}
          size={Math.round(size * 0.46)}
          strokeWidth={1.75}
          scale
          color="#fff"
        />
      </Gradient>
    );
  }
  return (
    <Avatar
      src={src}
      name={name}
      colorSeed={seed}
      size={size}
      kind={group ? 'group' : 'user'}
      style={style}
    />
  );
}

/** A soft expanding ring behind ringing avatars (the web's `animate-ping`). */
export function PingRing({ size, color = 'rgba(167,139,250,0.2)', duration = 2000, inset = 0 }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration,
        easing: Easing.bezier(0, 0, 0.2, 1),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: -inset,
        top: -inset,
        width: size + inset * 2,
        height: size + inset * 2,
        borderRadius: size,
        backgroundColor: color,
        opacity: v.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 0, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }) }],
      }}
    />
  );
}

/** Static concentric rings (`-inset-8 border-white/10`, `-inset-16 border-white/5`). */
export function HaloRings({ size, near = 32, far = 64 }) {
  const ring = (inset, alpha) => (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: -inset,
        top: -inset,
        width: size + inset * 2,
        height: size + inset * 2,
        borderRadius: size + inset * 2,
        borderWidth: 1,
        borderColor: `rgba(255,255,255,${alpha})`,
      }}
    />
  );
  return (
    <>
      {ring(near, 0.1)}
      {ring(far, 0.05)}
    </>
  );
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

/**
 * A MediaStream's video (react-native-webrtc's RTCView; a <video> in the web preview). Audio
 * plays natively, independent of this view. `zOrder` stacks overlapping native video
 * surfaces (the picture-in-picture above the full-screen video).
 */
export function VideoView({ stream, mirror, fit = 'cover', zOrder = 0, style }) {
  if (!stream) return <View style={[{ flex: 1, backgroundColor: '#000' }, style]} />;
  const props = isNativeWebRTC ? { streamURL: stream.toURL(), zOrder } : { stream };
  return (
    <RTCView
      {...props}
      mirror={!!mirror}
      objectFit={fit}
      style={[{ flex: 1, width: '100%', height: '100%', backgroundColor: '#000' }, style]}
    />
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** "0:42" since `connectedAt`, ticking every second (null while not connected). */
export function useCallDuration(connectedAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!connectedAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [connectedAt]);
  return connectedAt ? formatDuration(Math.max(0, now - connectedAt)) : null;
}

/**
 * Drag a floating box (`width` × `height`) inside `bounds` ({ width, height }); on release it
 * snaps to the nearest corner. A touch without movement is a tap.
 */
export function useDraggable({
  width,
  height,
  bounds,
  initial = 'br',
  margin = 16,
  topInset = 0,
  bottomInset = 0,
  onTap,
}) {
  const corner = useRef(initial);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const geom = useRef({ width, height, bounds, margin, topInset, bottomInset });
  geom.current = { width, height, bounds, margin, topInset, bottomInset };

  const pointFor = (c) => {
    const g = geom.current;
    return {
      x: c[1] === 'l' ? g.margin : g.bounds.width - g.width - g.margin,
      y:
        c[0] === 't'
          ? g.margin + g.topInset
          : g.bounds.height - g.height - g.margin - g.bottomInset,
    };
  };

  const pos = useRef(new Animated.ValueXY(pointFor(initial))).current;
  const [dragging, setDragging] = useState(false);

  // Re-snap when the space changes (rotation, controls shown/hidden).
  useEffect(() => {
    Animated.spring(pos, {
      toValue: pointFor(corner.current),
      useNativeDriver: false,
      bounciness: 0,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.width, bounds.height, width, height, topInset, bottomInset]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.hypot(g.dx, g.dy) > 6,
      onPanResponderGrant: () => {
        pos.extractOffset();
      },
      onPanResponderMove: (_, g) => {
        if (Math.hypot(g.dx, g.dy) > 6) setDragging(true);
        pos.setValue({ x: g.dx, y: g.dy });
      },
      onPanResponderRelease: (_, g) => {
        pos.flattenOffset();
        setDragging(false);
        if (Math.hypot(g.dx, g.dy) < 6) {
          tapRef.current?.();
          Animated.spring(pos, {
            toValue: pointFor(corner.current),
            useNativeDriver: false,
            bounciness: 0,
          }).start();
          return;
        }
        const gm = geom.current;
        const x = pos.x.__getValue();
        const y = pos.y.__getValue();
        const right = x + gm.width / 2 > gm.bounds.width / 2;
        const bottom = y + gm.height / 2 > gm.bounds.height / 2;
        corner.current = `${bottom ? 'b' : 't'}${right ? 'r' : 'l'}`;
        Animated.spring(pos, {
          toValue: pointFor(corner.current),
          useNativeDriver: false,
          bounciness: 4,
        }).start();
      },
      onPanResponderTerminate: () => {
        pos.flattenOffset();
        setDragging(false);
        Animated.spring(pos, {
          toValue: pointFor(corner.current),
          useNativeDriver: false,
        }).start();
      },
    }),
  ).current;

  return {
    dragging,
    handlers: responder.panHandlers,
    style: { position: 'absolute', left: pos.x, top: pos.y, width, height },
  };
}
