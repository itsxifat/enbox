/** Poll: options with vote bars, single/multiple choice, voter avatars and "View votes" (web PollBody.tsx). */
import { useState } from 'react';
import { View } from 'react-native';
import { Check, ListChecks } from 'lucide-react-native';
import { UserAvatar } from '@/components/common/avatars';
import { ICON_STROKE_BOLD, Icon } from '@/components/icons';
import { Modal, Press, T } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { useUserName } from '@/stores/users';
import { alpha, useTheme } from '@/theme';
import { isActionable, vote } from '../actions';
import { myVotesOf } from '../lib/optimistic';

function VoterRow({ userId }) {
  const { tw } = useTheme();
  const name = useUserName(userId, { you: 'You' });
  return (
    <View style={tw`flex-row items-center gap-3 py-1.5`}>
      <UserAvatar userId={userId} size="sm" />
      <T numberOfLines={1} style={tw`text-[15px]`}>
        {name}
      </T>
    </View>
  );
}

export function PollVotesDialog({ m, open, onClose }) {
  const { tw } = useTheme();
  const poll = m.poll;
  return (
    <Modal open={open} onClose={onClose} title="Poll details" description={poll.question}>
      <View style={tw`gap-4 pb-2`}>
        {poll.options.map((o) => (
          <View key={o.id}>
            <View style={tw`flex-row items-center justify-between gap-2`}>
              <T numberOfLines={1} style={tw`shrink text-[14px] font-semibold`}>
                {o.text}
              </T>
              <T style={tw`text-[13px] font-medium text-muted`}>
                {o.voteCount} vote{o.voteCount === 1 ? '' : 's'}
              </T>
            </View>
            {o.voterIds.length ? (
              <View style={tw`mt-1`}>
                {o.voterIds.map((id) => (
                  <VoterRow key={id} userId={id} />
                ))}
              </View>
            ) : (
              <T style={tw`mt-1 text-[13px] text-subtle`}>No votes</T>
            )}
          </View>
        ))}
      </View>
    </Modal>
  );
}

export function PollBody({ m, chat, mine, width }) {
  const { tw, c, dark } = useTheme();
  const me = useAuth((s) => s.user?.id) ?? '';
  const poll = m.poll;
  const [votesOpen, setVotesOpen] = useState(false);
  const mineVotes = myVotesOf(poll, me);
  const canVote = isActionable(m) && chat.membership === 'active';
  const anonymous = chat.type === 'channel';
  const maxVotes = Math.max(1, ...poll.options.map((o) => o.voteCount));
  const meta = mine ? c['bubble-out-meta'] : c['bubble-in-meta'];
  const ring = mine ? c['bubble-out'] : c['bubble-in'];
  return (
    <View style={[tw`gap-1 pt-1`, { width: Math.min(320, width ?? 320) }]}>
      <T style={tw`text-[15px] font-semibold leading-snug`}>{poll.question}</T>
      <View style={tw`mb-1 flex-row items-center gap-1`}>
        <Icon icon={ListChecks} size={14} color={meta} />
        <T style={[tw`text-[12px]`, { color: meta }]}>
          {poll.allowMultiple ? 'Select one or more' : 'Select one'}
        </T>
      </View>
      {poll.options.map((o) => {
        const selected = mineVotes.includes(o.id);
        const pct = poll.totalVoters ? o.voteCount / poll.totalVoters : 0;
        return (
          <Press
            key={o.id}
            disabled={!canVote}
            accessibilityRole={poll.allowMultiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: selected }}
            onPress={() => void vote(chat, m, o.id)}
            style={tw`w-full flex-row items-start gap-2.5 rounded-lg px-1 py-1.5`}
            pressedStyle={{ backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
          >
            <View
              style={[
                tw`mt-0.5 size-5 items-center justify-center border-2`,
                poll.allowMultiple ? tw`rounded-md` : tw`rounded-full`,
                selected
                  ? { borderColor: c.brand, backgroundColor: c.brand }
                  : { borderColor: alpha(c.fg, 0.5) },
              ]}
            >
              {selected ? (
                <Icon icon={Check} size={14} strokeWidth={ICON_STROKE_BOLD} color={c['on-brand']} />
              ) : null}
            </View>
            <View style={tw`min-w-0 flex-1 gap-1.5`}>
              <View style={tw`flex-row items-start justify-between gap-2`}>
                <T style={tw`shrink text-[14px] leading-snug`}>{o.text}</T>
                <View style={tw`flex-row items-center gap-1`}>
                  {!anonymous && o.voterIds.length ? (
                    <View style={tw`flex-row`}>
                      {o.voterIds.slice(0, 3).map((id, i) => (
                        <View
                          key={id}
                          style={[
                            tw`rounded-full`,
                            { marginLeft: i ? -6 : 0, borderWidth: 2, borderColor: ring },
                          ]}
                        >
                          <UserAvatar userId={id} size={18} />
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <T
                    style={[
                      tw`min-w-4 text-right text-[13px] font-medium`,
                      { fontVariant: ['tabular-nums'] },
                    ]}
                  >
                    {o.voteCount}
                  </T>
                </View>
              </View>
              <View
                style={[
                  tw`h-1.5 w-full overflow-hidden rounded-full`,
                  { backgroundColor: dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' },
                ]}
              >
                <View
                  style={[
                    tw`absolute inset-y-0 left-0 rounded-full`,
                    {
                      width: `${pct * 100}%`,
                      backgroundColor:
                        o.voteCount === maxVotes && o.voteCount > 0 ? c.brand : alpha(c.brand, 0.6),
                    },
                  ]}
                />
              </View>
            </View>
          </Press>
        );
      })}
      <View
        style={[
          tw`mt-1 flex-row items-center justify-between border-t pt-1.5`,
          { borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' },
        ]}
      >
        <T style={[tw`text-[12px]`, { color: meta }]}>
          {poll.totalVoters} voter{poll.totalVoters === 1 ? '' : 's'}
        </T>
        {!anonymous && poll.totalVoters > 0 ? (
          <Press onPress={() => setVotesOpen(true)} style={tw`rounded-full px-2.5 py-1`}>
            <T style={tw`text-[13px] font-semibold text-brand-ink`}>View votes</T>
          </Press>
        ) : null}
      </View>
      {votesOpen ? <PollVotesDialog m={m} open onClose={() => setVotesOpen(false)} /> : null}
    </View>
  );
}
