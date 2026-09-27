/** Day separators, the unread divider and system messages (web bubbles/SystemPill.tsx). */
import { View } from 'react-native';
import { Timer } from 'lucide-react-native';
import { chatKindOf, systemEventText } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { Press, T } from '@/components/ui';
import { formatDaySeparator } from '@/lib/format';
import { nameOf, useUsers } from '@/stores/users';
import { alpha, useTheme } from '@/theme';

export function Pill({ children, style }) {
  const { tw, c, shadow } = useTheme();
  return (
    <View style={tw`items-center px-4 py-1`}>
      <View
        style={[
          tw`rounded-lg px-3 py-1.5`,
          { maxWidth: '90%', backgroundColor: alpha(c.surface, 0.95) },
          shadow.bubble,
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export function DaySeparator({ date }) {
  const { tw, c, shadow } = useTheme();
  return (
    <View style={tw`items-center py-2`} accessibilityRole="header">
      <View
        style={[
          tw`rounded-lg px-3 py-1`,
          { backgroundColor: alpha(c.surface, 0.95) },
          shadow.bubble,
        ]}
      >
        <T style={tw`text-[12.5px] font-medium text-muted`}>{formatDaySeparator(date)}</T>
      </View>
    </View>
  );
}

export function UnreadDivider({ count }) {
  const { tw, c, shadow } = useTheme();
  return (
    <View style={[tw`my-2 items-center py-1`, { backgroundColor: alpha(c.surface, 0.6) }]}>
      <View style={[tw`rounded-full bg-surface px-3 py-0.5`, shadow.bubble]}>
        <T style={tw`text-[12.5px] font-semibold text-brand-ink`}>
          {count} unread message{count === 1 ? '' : 's'}
        </T>
      </View>
    </View>
  );
}

export function SystemPill({ m, chat, onJump }) {
  const { tw, c } = useTheme();
  useUsers((s) => s.byId);
  if (!m.system) return null;
  const text = systemEventText(m.system, (id) => nameOf(id), chatKindOf(chat));
  const pinned = m.system.kind === 'message_pinned' ? m.system.messageId : null;
  const timer = m.system.kind === 'disappearing_changed';
  const label = <T style={tw`text-center text-[12.5px] leading-snug text-muted`}>{text}</T>;
  return (
    <Pill>
      {pinned && onJump ? (
        <Press feedback={false} onPress={() => onJump(pinned)}>
          {label}
        </Press>
      ) : (
        <View style={tw`flex-row items-center justify-center gap-1.5`}>
          {timer ? <Icon icon={Timer} size={14} color={c.muted} /> : null}
          <View style={tw`shrink`}>{label}</View>
        </View>
      )}
    </Pill>
  );
}
