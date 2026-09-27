import { View } from 'react-native';
import { useTheme } from '@/theme';
import { T } from './primitives';

function toneColors(tone, c, dark) {
  switch (tone) {
    case 'muted':
      return { bg: c['unread-muted'], fg: dark ? c.fg : '#ffffff' };
    case 'danger':
      return { bg: c['danger-fill'], fg: '#ffffff' };
    case 'success':
      return { bg: c.success, fg: '#ffffff' };
    default:
      return { bg: c.unread, fg: c['on-brand'] };
  }
}

/**
 * Unread counter / status dot (web components/ui/Badge.tsx). `ring` draws the web's
 * `ring-2 ring-surface` (badges over icons/avatars).
 */
export function Badge({ count, max = 99, tone = 'brand', dot, size = 'md', ring, style, label }) {
  const { c, dark } = useTheme();
  const t = toneColors(tone, c, dark);
  const ringStyle = ring ? { borderWidth: 2, borderColor: ring === true ? c.surface : ring } : null;
  if (dot) {
    const px = (size === 'sm' ? 8 : 10) + (ring ? 4 : 0);
    return (
      <View
        accessibilityLabel={label}
        style={[
          { width: px, height: px, borderRadius: px, backgroundColor: t.bg },
          ringStyle,
          style,
        ]}
      />
    );
  }
  if (!count || count <= 0) return null;
  const text = count > max ? `${max}+` : String(count);
  const h = (size === 'sm' ? 18 : 20) + (ring ? 4 : 0);
  return (
    <View
      accessibilityLabel={label}
      style={[
        {
          height: h,
          minWidth: h,
          paddingHorizontal: size === 'sm' ? 4 : 6,
          borderRadius: 999,
          backgroundColor: t.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        ringStyle,
        style,
      ]}
    >
      <T
        style={{
          color: t.fg,
          fontSize: size === 'sm' ? 11 : 12,
          lineHeight: size === 'sm' ? 13 : 14,
          fontWeight: '600',
          fontVariant: ['tabular-nums'],
        }}
      >
        {text}
      </T>
    </View>
  );
}
