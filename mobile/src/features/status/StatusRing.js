/**
 * Segmented status ring and the tiny status preview (web features/status/StatusRing.tsx).
 */
import { View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle } from 'react-native-svg';
import { T } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import { useTheme } from '@/theme';
import { fontStyle, ringSegments, textStatusSize } from './logic';

/**
 * One arc per status (oldest first, clockwise from 12 o'clock): unseen arcs in brand colour,
 * seen arcs grey. `children` sits inside (avatar / preview).
 */
export function StatusRing({ statuses, size = 56, stroke = 2.5, children, style }) {
  const { c } = useTheme();
  const segs = ringSegments(statuses.length, size, stroke);
  const inner = size - stroke * 2 - 4;
  return (
    <View
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'absolute', left: 0, top: 0, transform: [{ rotate: '-90deg' }] }}
      >
        {segs.map((s, i) => (
          <Circle
            key={statuses[i]?.id ?? i}
            cx={size / 2}
            cy={size / 2}
            r={s.r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={s.dasharray}
            strokeDashoffset={s.dashoffset}
            stroke={statuses[i]?.viewed ? c['line-strong'] : c.brand}
          />
        ))}
      </Svg>
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: inner,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** A tiny preview of a status (photo/video poster or the text on its colour). */
export function StatusThumb({ status, size }) {
  if (status.type === 'text') {
    const box = 160;
    const text = status.text ?? '';
    return (
      <View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: status.backgroundColor ?? '#6D5DFC',
        }}
      >
        <View
          style={{
            width: box,
            height: box,
            padding: 24,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: size / box }],
          }}
        >
          <T
            numberOfLines={4}
            style={[
              {
                color: '#fff',
                textAlign: 'center',
                fontSize: Math.max(14, Math.round(textStatusSize(text) * 0.55)),
                lineHeight: Math.max(14, Math.round(textStatusSize(text) * 0.55)) * 1.25,
              },
              fontStyle(status.font),
            ]}
          >
            {text}
          </T>
        </View>
      </View>
    );
  }
  const src = mediaUrl(
    status.media?.thumbnailUrl ?? (status.type === 'image' ? status.media?.url : null),
  );
  return (
    <View style={{ width: size, height: size, backgroundColor: '#000' }}>
      {src ? (
        <Image source={{ uri: src }} style={{ width: size, height: size }} contentFit="cover" />
      ) : null}
    </View>
  );
}
