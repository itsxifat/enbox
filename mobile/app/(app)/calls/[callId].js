/**
 * Call info (web features/calls/CallDetails.tsx): who, when, how long, the related calls of
 * the same log group, participants of group calls, and actions (message, call back, remove).
 * A call that isn't in the loaded log pages is fetched on its own.
 */
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MessageCircle, Trash2 } from 'lucide-react-native';
import { chatTitle } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { Icon, PhoneIcon, PhoneMissedIcon, VideoIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  EmptyState,
  IconButton,
  ListItem,
  PageSpinner,
  Press,
  SectionLabel,
  T,
  confirm,
} from '@/components/ui';
import { canCallBack } from '@/features/calls/callBack';
import {
  CallChatAvatar,
  DirectionIcon,
  durationText,
  outcomeText,
  removeEntries,
} from '@/features/calls/log';
import { callKindLabel, groupCallLog } from '@/features/calls/logic';
import { ApiError, api } from '@/lib/api';
import { formatDaySeparator, formatTime } from '@/lib/format';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { useUserName } from '@/stores/users';
import { useTheme } from '@/theme';

const STATUS_TEXT = {
  joined: 'In the call',
  left: 'Joined',
  invited: 'Invited',
  ringing: 'Ringing',
  declined: 'Declined',
  missed: 'No answer',
  busy: 'On another call',
};

function ParticipantRow({ p, initiatorId }) {
  const name = useUserName(p.userId);
  const status = p.userId === initiatorId ? 'Started the call' : STATUS_TEXT[p.status];
  return (
    <ListItem
      dense
      leading={<UserAvatar userId={p.userId} size="md" />}
      title={name}
      subtitle={status}
    />
  );
}

function useCallEntry(callId, skip) {
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (!callId || skip) return;
    let alive = true;
    setFetched({ callId, state: 'loading' });
    api
      .get(`/api/calls/${encodeURIComponent(callId)}`)
      .then((entry) => alive && setFetched({ callId, state: 'ok', entry }))
      .catch((e) => {
        if (!alive) return;
        if (!(e instanceof ApiError && e.status === 404)) console.warn('[calls] call info', e);
        setFetched({ callId, state: 'missing' });
      });
    return () => {
      alive = false;
    };
  }, [callId, skip]);
  return fetched?.callId === callId ? fetched : null;
}

function Card({ title, children }) {
  const { tw, shadow } = useTheme();
  return (
    <View style={[tw`m-3 overflow-hidden rounded-3xl bg-surface pb-2`, shadow.sm]}>
      {title ? (
        <View style={tw`px-4 pt-4 pb-1.5`}>
          <SectionLabel>{title}</SectionLabel>
        </View>
      ) : null}
      {children}
    </View>
  );
}

function ActionButton({ icon, label, onPress }) {
  const { tw, c } = useTheme();
  return (
    <Press
      onPress={onPress}
      pressedStyle={tw`bg-brand-soft`}
      style={tw`w-20 items-center gap-1.5 rounded-2xl border border-line py-2.5`}
    >
      <Icon icon={icon} size={20} color={c['brand-ink']} />
      <T style={tw`text-[13px] font-medium text-brand-ink`}>{label}</T>
    </Press>
  );
}

export default function CallDetailsScreen() {
  const { tw, shadow } = useTheme();
  const { callId } = useLocalSearchParams();
  const router = useRouter();
  const log = useCalls((s) => s.log);

  useEffect(() => {
    void useCalls.getState().loadLog();
  }, []);

  const logGroup = useMemo(
    () => groupCallLog(log.entries).find((g) => g.entries.some((e) => e.call.id === callId)),
    [log.entries, callId],
  );
  const fetched = useCallEntry(callId, !!logGroup);
  const single = fetched?.state === 'ok' ? fetched.entry : null;
  const group =
    logGroup ?? (single ? { key: single.call.id, entries: [single], head: single } : undefined);
  const entry = group?.entries.find((e) => e.call.id === callId);
  const liveChat = useChats((s) => (entry ? s.byId[entry.chat.id] : undefined));

  if (!entry || !group) {
    const logSettled = log.loaded || !!log.error;
    if (!logSettled || !fetched || fetched.state === 'loading')
      return (
        <View style={tw`flex-1 bg-app`}>
          <PaneHeader title="Call info" back="/calls" />
          <PageSpinner />
        </View>
      );
    return (
      <View style={tw`flex-1 bg-app`}>
        <PaneHeader title="Call info" back="/calls" />
        <View style={tw`flex-1 items-center justify-center`}>
          <EmptyState
            icon={PhoneMissedIcon}
            title="Call not found"
            description="It may have been removed from your call log."
          />
        </View>
      </View>
    );
  }

  const title = chatTitle(entry.chat);
  const call = entry.call;
  const callable = canCallBack(liveChat);
  const start = (type) => void useCalls.getState().startCall(entry.chat.id, type);
  const openChat = () => router.push(`/chats/${entry.chat.id}`);
  const remove = async () => {
    const n = group.entries.length;
    const ok = await confirm({
      title: n > 1 ? `Remove ${n} calls from your log?` : 'Remove this call from your log?',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await removeEntries(group.entries);
    if (router.canGoBack()) router.back();
    else router.replace('/calls');
  };

  return (
    <View style={tw`flex-1 bg-app`}>
      <PaneHeader
        title="Call info"
        back="/calls"
        actions={
          <>
            <IconButton icon={MessageCircle} label="Message" onPress={openChat} />
            <IconButton icon={Trash2} label="Remove from call log" onPress={() => void remove()} />
          </>
        }
      />
      <ScrollView style={tw`min-h-0 flex-1`} contentContainerStyle={tw`pb-6`}>
        <View style={[tw`m-3 items-center gap-3 rounded-3xl bg-surface px-6 py-7`, shadow.sm]}>
          <CallChatAvatar chat={entry.chat} size="2xl" />
          <View style={tw`items-center`}>
            <T style={[tw`text-center text-[22px] font-semibold`, { letterSpacing: -0.5 }]}>
              {title}
            </T>
            <T style={tw`mt-0.5 text-[14px] text-muted`}>{callKindLabel(call)}</T>
          </View>
          <View style={tw`mt-2 flex-row gap-3`}>
            <ActionButton icon={MessageCircle} label="Message" onPress={openChat} />
            {callable ? (
              <>
                <ActionButton icon={PhoneIcon} label="Voice" onPress={() => start('audio')} />
                <ActionButton icon={VideoIcon} label="Video" onPress={() => start('video')} />
              </>
            ) : null}
          </View>
        </View>

        <Card title={formatDaySeparator(call.createdAt)}>
          {group.entries.map((e) => {
            const outcome = outcomeText(e);
            const duration = durationText(e);
            return (
              <View key={e.call.id} style={tw`flex-row items-center gap-3 px-4 py-2.5`}>
                <DirectionIcon entry={e} />
                <View style={tw`min-w-0 flex-1`}>
                  <T style={tw`text-[15px]`}>
                    {e.direction === 'incoming' ? 'Incoming' : 'Outgoing'}{' '}
                    {e.call.type === 'video' ? 'video' : 'voice'} call
                  </T>
                  <T style={tw`text-[13px] text-muted`}>
                    {[formatTime(e.call.createdAt), outcome || null].filter(Boolean).join(' · ')}
                  </T>
                </View>
                <T style={[tw`text-[13px] text-muted`, { fontVariant: ['tabular-nums'] }]}>
                  {duration ?? (e.outcome === 'answered' ? '0:00' : '')}
                </T>
              </View>
            );
          })}
        </Card>

        {call.isGroup ? (
          <Card title={`${call.participants.length} participants`}>
            {[...call.participants]
              .sort((a, b) =>
                a.userId === call.initiatorId ? -1 : b.userId === call.initiatorId ? 1 : 0,
              )
              .map((p) => (
                <ParticipantRow key={p.userId} p={p} initiatorId={call.initiatorId} />
              ))}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
