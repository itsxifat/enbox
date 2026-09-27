/**
 * "Ongoing call" banner under a conversation's header (web features/calls/OngoingCallBanner):
 * the live group call with who's in it and a Join / Return button.
 */
import { View } from 'react-native';
import { UserAvatar } from '@/components/common/avatars';
import { Icon, PhoneIcon, VideoIcon } from '@/components/icons';
import { Press, T } from '@/components/ui';
import { useMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useTheme } from '@/theme';
import { useActiveCallForChat } from './hooks';
import { joinedOthers } from './logic';
import { useCallDuration } from './ui/primitives';

export function OngoingCallBanner({ chatId, style }) {
  const { tw, c } = useTheme();
  const state = useActiveCallForChat(chatId);
  const me = useMe()?.id ?? '';
  const connectedAt = useCalls((s) => (state.inCallHere ? (s.active?.connectedAt ?? null) : null));
  const duration = useCallDuration(connectedAt);
  const { call } = state;
  if (!call || (!call.isGroup && !state.inCallHere)) return null;
  if (!state.inCallHere && !state.canJoin && !state.inCallElsewhere) return null;

  const video = call.type === 'video';
  const joined = joinedOthers(call, me);
  const label = state.inCallHere
    ? `You're in this call${duration ? ` · ${duration}` : ''}`
    : state.inCallElsewhere
      ? "You're in this call on another device"
      : `${video ? 'Video' : 'Voice'} call in progress · ${state.joinedCount} joined`;

  const action = state.inCallHere
    ? { label: 'Return', run: () => useCalls.getState().setMinimized(false) }
    : state.canJoin
      ? { label: 'Join', run: () => void useCalls.getState().joinCall(call.id) }
      : null;

  return (
    <View
      accessibilityLabel="Ongoing call"
      style={[
        tw`mx-3 mb-2 flex-row items-center gap-3 rounded-xl bg-success-soft px-4 py-2`,
        style,
      ]}
    >
      <View style={tw`size-8 items-center justify-center rounded-full bg-success`}>
        <Icon icon={video ? VideoIcon : PhoneIcon} size={16} color="#ffffff" />
      </View>
      <View style={tw`min-w-0 flex-1`}>
        <T numberOfLines={1} style={tw`text-[14px] font-medium`}>
          {label}
        </T>
        {joined.length ? (
          <View style={tw`mt-0.5 flex-row`}>
            {joined.slice(0, 5).map((p, i) => (
              <View
                key={p.userId}
                style={[
                  tw`rounded-full`,
                  { marginLeft: i ? -6 : 0, borderWidth: 2, borderColor: c['success-soft'] },
                ]}
              >
                <UserAvatar userId={p.userId} size={20} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {action ? (
        <Press
          onPress={action.run}
          feedback={false}
          style={tw`h-8 justify-center rounded-full bg-success px-4`}
        >
          <T style={tw`text-[14px] font-semibold text-white`}>{action.label}</T>
        </Press>
      ) : null}
    </View>
  );
}
