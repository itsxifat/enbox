/**
 * Chat appearance for a conversation (web useChatAppearance + ChatBackground +
 * appearance.css): private override > shared theme > device prefs > tokens, turned into
 * colour overrides for `ColorScope` and a wallpaper layer — the flat colour with the faint
 * brand dot pattern, the animated presets (aurora, drift, starfield, waves), or an uploaded
 * image / looping video, with dim and blur.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import Svg, { Circle, Defs, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { mediaUrl } from '@/lib/api';
import { useUi } from '@/stores/ui';
import { mix, useTheme } from '@/theme';
import { WALLPAPER_PRESET_DEFS, resolveAppearance } from './presets';

/** The resolved appearance of a chat + the colour overrides for its subtree. */
export function useChatAppearance(chat) {
  const { c } = useTheme();
  const prefs = useUi((s) => s.prefs);
  const resolvedTheme = useUi((s) => s.resolvedTheme);
  const override = chat?.theme ?? null;
  const shared = chat?.sharedTheme ?? null;
  const media = chat?.wallpaper ?? null;
  return useMemo(() => {
    const a = resolveAppearance({ override, shared, device: prefs, resolvedTheme, media });
    const colors = {};
    for (const [k, v] of Object.entries(a.style)) {
      if (typeof v !== 'string' || v.startsWith('color-mix')) continue;
      colors[k.replace(/^--/, '')] = v;
    }
    if (a.accent) {
      colors['bubble-out'] = a.accent;
      colors['bubble-out-meta'] = mix(c.fg, 62, a.accent);
      colors['tick-read'] = mix(c.fg, 55, a.accent);
      colors['brand-soft'] = mix(a.accent, 24, c.surface);
    }
    return { ...a, colors };
  }, [override, shared, media, prefs, resolvedTheme, c.fg, c.surface]);
}

function useLoop(duration, enabled) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(v, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [duration, enabled, v]);
  return v;
}

function Dots({ ink }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id="enbox-dots" x="0" y="0" width="26" height="26" patternUnits="userSpaceOnUse">
          <Circle cx="13" cy="13" r="1.25" fill={ink} />
          <Circle cx="0" cy="0" r="1.25" fill={ink} />
          <Circle cx="26" cy="0" r="1.25" fill={ink} />
          <Circle cx="0" cy="26" r="1.25" fill={ink} />
          <Circle cx="26" cy="26" r="1.25" fill={ink} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#enbox-dots)" />
    </Svg>
  );
}

function Blob({ id, cx, cy, r, color, opacity }) {
  return (
    <>
      <Defs>
        <RadialGradient id={id} cx={cx} cy={cy} rx={r} ry={r} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="400" height="800" fill={`url(#${id})`} />
    </>
  );
}

function AnimatedLayer({ duration, dx, dy, motion, children }) {
  const v = useLoop(duration, motion);
  return (
    <Animated.View
      style={[
        { position: 'absolute', top: '-25%', left: '-25%', right: '-25%', bottom: '-25%' },
        {
          transform: [
            { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-dx, dx] }) },
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-dy, dy] }) },
          ],
        },
      ]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        {children}
      </Svg>
    </Animated.View>
  );
}

function AnimatedPreset({ id, dark, motion }) {
  if (id === 'aurora')
    return (
      <>
        <AnimatedLayer duration={11000} dx={24} dy={18} motion={motion}>
          <Blob id="a1" cx="80" cy="240" r="190" color="#7c5cff" opacity={0.35} />
          <Blob id="a2" cx="300" cy="520" r="180" color="#38bdf8" opacity={0.3} />
        </AnimatedLayer>
        <AnimatedLayer duration={14000} dx={-26} dy={-20} motion={motion}>
          <Blob id="a3" cx="280" cy="200" r="170" color="#34d399" opacity={0.28} />
          <Blob id="a4" cx="100" cy="600" r="170" color="#f472b6" opacity={0.22} />
        </AnimatedLayer>
      </>
    );
  if (id === 'drift')
    return (
      <>
        <AnimatedLayer duration={18000} dx={16} dy={-22} motion={motion}>
          <Circle cx="60" cy="160" r="120" fill="#6d5dfc" fillOpacity={0.16} />
          <Circle cx="320" cy="240" r="90" fill="#6d5dfc" fillOpacity={0.1} />
          <Circle cx="160" cy="640" r="140" fill="#6d5dfc" fillOpacity={0.12} />
        </AnimatedLayer>
        <AnimatedLayer duration={15000} dx={-20} dy={16} motion={motion}>
          <Circle cx="280" cy="600" r="110" fill="#38bdf8" fillOpacity={0.12} />
          <Circle cx="120" cy="400" r="70" fill="#f472b6" fillOpacity={0.1} />
        </AnimatedLayer>
      </>
    );
  if (id === 'starfield') {
    const color = dark ? '#ffffff' : '#3c4678';
    const stars = [];
    for (let i = 0; i < 90; i++) {
      const x = (i * 97) % 400;
      const y = (i * 173) % 800;
      stars.push(
        <Circle
          key={i}
          cx={x}
          cy={y}
          r={i % 3 ? 1 : 1.4}
          fill={color}
          fillOpacity={dark ? 0.6 : 0.3}
        />,
      );
    }
    return (
      <AnimatedLayer duration={30000} dx={0} dy={40} motion={motion}>
        {stars}
      </AnimatedLayer>
    );
  }
  if (id === 'waves') {
    const color = dark ? '#38bdf8' : '#0b7db0';
    return (
      <AnimatedLayer duration={9000} dx={30} dy={6} motion={motion}>
        {[180, 320, 460, 600].map((y, i) => (
          <Path
            key={y}
            d={`M-40 ${y} C 60 ${y - 40}, 160 ${y + 40}, 260 ${y} S 460 ${y - 40}, 520 ${y}`}
            stroke={color}
            strokeOpacity={0.12 + i * 0.02}
            strokeWidth={26}
            fill="none"
          />
        ))}
      </AnimatedLayer>
    );
  }
  return null;
}

/** The media wallpaper's player (only mounted for video wallpapers). */
function VideoWallpaper({ uri, motion, style }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    if (motion) p.play();
  });
  useEffect(() => {
    if (motion) player.play();
    else player.pause();
  }, [motion, player]);
  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
}

export function ChatBackground({ appearance }) {
  const { c, dark } = useTheme();
  const patternOn = useUi((s) => s.prefs.wallpaperPattern);
  const reduce = useUi((s) => s.prefs.reduceMotion === 'on');
  const motion = !reduce;
  const { wallpaper, media, dim, blur } = appearance;
  const preset = wallpaper.kind === 'preset' ? WALLPAPER_PRESET_DEFS[wallpaper.id] : null;
  const animated = !!preset?.animated;
  const showDots = patternOn && !media && !animated;
  const mediaStyle = [StyleSheet.absoluteFill, blur ? { transform: [{ scale: 1.06 }] } : null];
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: c.wallpaper, overflow: 'hidden' }]}
    >
      {showDots ? <Dots ink={c['wallpaper-ink']} /> : null}
      {animated ? <AnimatedPreset id={wallpaper.id} dark={dark} motion={motion} /> : null}
      {media?.kind === 'video' ? (
        <VideoWallpaper uri={mediaUrl(media.url)} motion={motion} style={mediaStyle} />
      ) : media ? (
        <Image
          source={{
            uri:
              media.animated && !motion && media.thumbnailUrl
                ? mediaUrl(media.thumbnailUrl)
                : mediaUrl(media.url),
          }}
          style={mediaStyle}
          contentFit="cover"
          blurRadius={blur || 0}
          autoplay={motion}
        />
      ) : null}
      {dim > 0 ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: dim / 100 }]} />
      ) : null}
    </View>
  );
}
