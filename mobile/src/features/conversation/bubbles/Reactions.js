/** Reaction pill under a bubble and the "who reacted" sheet (web bubbles/Reactions.tsx). */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { UserAvatar } from '@/components/common/avatars';
import { Modal, Press, T, Tabs } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { useUserName } from '@/stores/users';
import { useTheme } from '@/theme';
import { canReact, react } from '../actions';

export function ReactionPill({ reactions, onPress, myReaction }) {
  const { tw, c, shadow } = useTheme();
  const total = reactions.reduce((n, r) => n + r.count, 0);
  const top = [...reactions].sort((a, b) => b.count - a.count).slice(0, 3);
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={`Reactions: ${reactions.map((r) => `${r.emoji} ${r.count}`).join(', ')}`}
      feedback={false}
      style={[
        tw`h-6 flex-row items-center gap-0.5 rounded-full border px-1.5`,
        { borderColor: c.surface, backgroundColor: myReaction ? c['brand-soft'] : c.elevated },
        shadow.bubble,
      ]}
    >
      {top.map((r) => (
        <T key={r.emoji} style={{ fontSize: 13, lineHeight: 16 }}>
          {r.emoji}
        </T>
      ))}
      {total > 1 ? (
        <T
          style={[
            tw`ml-0.5 text-[12px] font-medium text-muted`,
            { lineHeight: 14, fontVariant: ['tabular-nums'] },
          ]}
        >
          {total}
        </T>
      ) : null}
    </Press>
  );
}

function ReactorRow({ userId, emoji, onRemove }) {
  const { tw } = useTheme();
  const name = useUserName(userId, { you: 'You' });
  return (
    <Press
      disabled={!onRemove}
      onPress={onRemove}
      style={tw`flex-row items-center gap-3 rounded-xl px-2 py-2`}
    >
      <UserAvatar userId={userId} size="md" />
      <View style={tw`min-w-0 flex-1`}>
        <T numberOfLines={1} style={tw`text-[15px] font-medium`}>
          {name}
        </T>
        {onRemove ? <T style={tw`text-[12px] text-muted`}>Tap to remove</T> : null}
      </View>
      <T style={{ fontSize: 24, lineHeight: 32 }}>{emoji}</T>
    </Press>
  );
}

export function ReactionsDialog({ m, chat, open, onClose }) {
  const { tw } = useTheme();
  const me = useAuth((s) => s.user?.id);
  const [tab, setTab] = useState('all');
  const anonymous = chat.type === 'channel';
  const total = m.reactions.reduce((n, r) => n + r.count, 0);
  const entries = useMemo(() => {
    const out = [];
    for (const r of m.reactions) for (const u of r.userIds) out.push({ userId: u, emoji: r.emoji });
    return out.sort((a, b) => (a.userId === me ? -1 : b.userId === me ? 1 : 0));
  }, [m.reactions, me]);
  const current = m.reactions.some((r) => r.emoji === tab) ? tab : 'all';
  const shown = current === 'all' ? entries : entries.filter((e) => e.emoji === current);
  const removable = canReact(chat, m);
  return (
    <Modal open={open} onClose={onClose} title={`${total} reaction${total === 1 ? '' : 's'}`}>
      <Tabs
        value={current}
        onChange={setTab}
        style={tw`-mx-2`}
        items={[
          { value: 'all', label: `All ${total}` },
          ...m.reactions.map((r) => ({ value: r.emoji, label: `${r.emoji} ${r.count}` })),
        ]}
      />
      {anonymous ? (
        <View style={tw`gap-1 py-3`}>
          {m.reactions.map((r) => (
            <View key={r.emoji} style={tw`flex-row items-center justify-between px-2 py-1.5`}>
              <T style={{ fontSize: 24, lineHeight: 32 }}>{r.emoji}</T>
              <T style={tw`text-muted`}>{r.count}</T>
            </View>
          ))}
        </View>
      ) : (
        <View style={tw`py-2`}>
          {shown.map((e) => (
            <ReactorRow
              key={`${e.userId}:${e.emoji}`}
              userId={e.userId}
              emoji={e.emoji}
              onRemove={
                e.userId === me && removable
                  ? () => {
                      onClose();
                      void react(chat, m, null);
                    }
                  : undefined
              }
            />
          ))}
        </View>
      )}
    </Modal>
  );
}
