/**
 * Calls tab (web features/calls/CallsPane.tsx): ongoing calls I can join, then the call log
 * (paged, grouped like WhatsApp), All/Missed filters, search, call back buttons, clear log.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { EllipsisVertical, RefreshCw, Trash2 } from 'lucide-react-native';
import { chatTitle } from '@enbox/shared';
import { Icon, PhoneCallIcon, PhoneIcon, PhoneMissedIcon, VideoIcon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  ActionSheet,
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  ListItem,
  ListItemSkeleton,
  Press,
  SearchInput,
  SectionLabel,
  Spinner,
  T,
  Tabs,
  confirm,
  toast,
} from '@/components/ui';
import { canCallBack } from '@/features/calls/callBack';
import { useMarkCallsVisited } from '@/features/calls/hooks';
import {
  CallChatAvatar,
  DirectionIcon,
  durationText,
  outcomeText,
  removeEntries,
} from '@/features/calls/log';
import {
  callKindLabel,
  groupCallLog,
  isMissedEntry,
  joinedOthers,
  participantOf,
} from '@/features/calls/logic';
import { formatRelativeShort } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { useTheme } from '@/theme';

function Section({ title }) {
  const { tw } = useTheme();
  return (
    <View style={tw`px-4 pt-4 pb-1.5`}>
      <SectionLabel>{title}</SectionLabel>
    </View>
  );
}

export default function CallsScreen() {
  const { tw } = useTheme();
  const router = useRouter();
  const log = useCalls((s) => s.log);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  useMarkCallsVisited();

  useEffect(() => {
    void useCalls.getState().loadLog({ refresh: true });
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const entries = q
      ? log.entries.filter((e) => chatTitle(e.chat).toLowerCase().includes(q))
      : log.entries;
    return groupCallLog(
      entries.filter((e) => e.outcome !== 'ongoing'),
      filter,
    );
  }, [log.entries, query, filter]);
  const missedCount = useMemo(() => log.entries.filter(isMissedEntry).length, [log.entries]);
  const ongoing = useOngoingCalls(query);

  const clearLog = async () => {
    const ok = await confirm({
      title: 'Clear call log?',
      message: 'This removes every call from your call log on all your devices.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!ok) return;
    try {
      await useCalls.getState().clearLog();
      toast.success('Call log cleared');
    } catch (e) {
      toast.error(e);
    }
  };

  const renderRow = useCallback(({ item }) => <CallLogRow group={item} />, []);

  let empty = null;
  if (!log.loaded && log.loading) empty = <ListItemSkeleton count={8} />;
  else if (!log.loaded && log.error)
    empty = (
      <EmptyState
        icon={PhoneMissedIcon}
        title="Couldn't load your calls"
        description={log.error}
        action={
          <Button
            variant="soft"
            leftIcon={RefreshCw}
            onPress={() => void useCalls.getState().loadLog({ refresh: true })}
          >
            Try again
          </Button>
        }
      />
    );
  else if (!groups.length && !(ongoing.length && !query && filter === 'all'))
    empty = (
      <EmptyState
        icon={filter === 'missed' ? PhoneMissedIcon : PhoneIcon}
        title={query ? 'No calls found' : filter === 'missed' ? 'No missed calls' : 'No calls yet'}
        description={
          query
            ? `No calls with "${query.trim()}".`
            : filter === 'missed'
              ? "Calls you don't answer will show up here."
              : 'Start a voice or video call with your contacts and groups.'
        }
        action={
          !query && filter === 'all' ? (
            <Button leftIcon={PhoneCallIcon} onPress={() => router.push('/calls/new')}>
              Start a call
            </Button>
          ) : undefined
        }
      />
    );

  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        title="Calls"
        large
        actions={
          <>
            <IconButton
              icon={PhoneCallIcon}
              label="New call"
              onPress={() => router.push('/calls/new')}
            />
            <DropdownMenu
              trigger={(t) => <IconButton {...t} icon={EllipsisVertical} label="Menu" />}
              items={[
                {
                  label: 'New call',
                  icon: PhoneCallIcon,
                  onSelect: () => router.push('/calls/new'),
                },
                {
                  label: 'Clear call log',
                  icon: Trash2,
                  danger: true,
                  disabled: !log.entries.length,
                  onSelect: () => void clearLog(),
                },
              ]}
            />
          </>
        }
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Search calls" />
        <Tabs
          variant="chips"
          style={tw`mt-2`}
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'All' },
            { value: 'missed', label: 'Missed', count: missedCount || undefined },
          ]}
        />
      </PaneHeader>
      <FlatList
        style={tw`min-h-0 flex-1`}
        data={empty ? [] : groups}
        keyExtractor={(g) => g.key}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (log.loaded && log.hasMore && !log.loadingMore) void useCalls.getState().loadMoreLog();
        }}
        ListHeaderComponent={
          <>
            {ongoing.length ? (
              <View>
                <Section title="Ongoing" />
                {ongoing.map((c) => (
                  <OngoingRow key={c.id} call={c} />
                ))}
              </View>
            ) : null}
            {empty}
            {!empty && groups.length ? <Section title="Recent" /> : null}
          </>
        }
        ListFooterComponent={
          <View style={tw`h-14 items-center justify-center`}>
            {log.loadingMore ? <Spinner size={20} /> : null}
          </View>
        }
      />
    </View>
  );
}

function CallLogRow({ group }) {
  const { tw, c } = useTheme();
  const router = useRouter();
  const { head, entries } = group;
  const [menu, setMenu] = useState(false);
  const missed = isMissedEntry(head);
  const outcome = outcomeText(head);
  const duration = durationText(head);
  const title = chatTitle(head.chat);
  const time = formatRelativeShort(head.call.createdAt);
  const callBack = (type) => void useCalls.getState().startCall(head.chat.id, type);
  const callable = canCallBack(useChats((s) => s.byId[head.chat.id]));

  return (
    <>
      <ListItem
        onPress={() => router.push(`/calls/${head.call.id}`)}
        onLongPress={() => setMenu(true)}
        accessibilityLabel={`${title}, ${head.direction} ${callKindLabel(head.call).toLowerCase()}${outcome ? `, ${outcome}` : ''}, ${time}`}
        leading={<CallChatAvatar chat={head.chat} />}
        title={
          <T
            numberOfLines={1}
            style={[tw`text-[16px] font-medium`, missed ? tw`text-danger` : null]}
          >
            {title}
            {entries.length > 1 ? <T style={tw`font-normal`}> ({entries.length})</T> : null}
          </T>
        }
        subtitle={
          <View style={tw`min-w-0 flex-row items-center gap-1.5`}>
            <DirectionIcon entry={head} />
            <T numberOfLines={1} style={tw`min-w-0 flex-1 text-[14px] text-muted`}>
              {[outcome && outcome !== 'Missed' ? outcome : null, time, duration]
                .filter(Boolean)
                .join(' · ')}
            </T>
          </View>
        }
        end={
          callable ? (
            <Press
              accessibilityLabel={`${head.call.type === 'video' ? 'Video' : 'Voice'} call ${title}`}
              onPress={() => callBack(head.call.type)}
              pressedStyle={tw`bg-brand-soft`}
              style={tw`size-10 items-center justify-center rounded-full`}
            >
              <Icon
                icon={head.call.type === 'video' ? VideoIcon : PhoneIcon}
                size={20}
                color={c['brand-ink']}
              />
            </Press>
          ) : null
        }
      />
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        items={[
          callable && { label: 'Voice call', icon: PhoneIcon, onSelect: () => callBack('audio') },
          callable && { label: 'Video call', icon: VideoIcon, onSelect: () => callBack('video') },
          { label: 'Call info', onSelect: () => router.push(`/calls/${head.call.id}`) },
          'separator',
          {
            label:
              entries.length > 1
                ? `Remove ${entries.length} calls from log`
                : 'Remove from call log',
            icon: Trash2,
            danger: true,
            onSelect: () => void removeEntries(entries),
          },
        ]}
      />
    </>
  );
}

/** Live calls in my chats that I can join or am in (group calls; 1:1 only while I'm in them). */
function useOngoingCalls(query) {
  const me = useMe()?.id ?? '';
  const liveCalls = useCalls((s) => s.liveCalls);
  const active = useCalls((s) => s.active);
  const chats = useChats((s) => s.byId);
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(liveCalls)
      .filter((c) => {
        const mine = participantOf(c, me);
        const here = active?.call.id === c.id && active.phase !== 'ended';
        if (!here && mine && (mine.status === 'invited' || mine.status === 'ringing')) return false;
        if (!c.isGroup && !here) return false;
        return joinedOthers(c, me).length > 0 || here;
      })
      .filter((c) => {
        const chat = chats[c.chatId];
        return !q || (chat ? chatTitle(chat).toLowerCase().includes(q) : false);
      });
  }, [liveCalls, active, chats, me, query]);
}

function OngoingRow({ call }) {
  const { tw, c } = useTheme();
  const me = useMe()?.id ?? '';
  const chat = useChats((s) => s.byId[call.chatId]);
  const active = useCalls((s) => s.active);
  const here = active?.call.id === call.id && active.phase !== 'ended';
  const elsewhere = !here && participantOf(call, me)?.status === 'joined';
  const joined = joinedOthers(call, me).length + (here || elsewhere ? 1 : 0);
  const title = chat ? chatTitle(chat) : 'Group call';
  return (
    <ListItem
      leading={
        <View>
          <CallChatAvatar
            chat={
              chat ?? { id: call.chatId, type: 'group', name: title, avatarUrl: null, peer: null }
            }
          />
          <View
            style={[
              tw`absolute -right-0.5 -bottom-0.5 size-5 items-center justify-center rounded-full bg-success`,
              { borderWidth: 2, borderColor: c.surface },
            ]}
          >
            <Icon icon={call.type === 'video' ? VideoIcon : PhoneIcon} size={12} color="#fff" />
          </View>
        </View>
      }
      title={title}
      subtitle={
        <T numberOfLines={1} style={tw`text-[14px] text-success`}>
          {here
            ? "You're in this call"
            : elsewhere
              ? 'Joined on another device'
              : `${callKindLabel(call)} · ${joined} joined`}
        </T>
      }
      end={
        here ? (
          <Button size="sm" variant="soft" onPress={() => useCalls.getState().setMinimized(false)}>
            Return
          </Button>
        ) : elsewhere ? null : (
          <Press
            onPress={() => void useCalls.getState().joinCall(call.id)}
            feedback={false}
            style={tw`h-8 justify-center rounded-full bg-success px-4`}
          >
            <T style={tw`text-[14px] font-semibold text-white`}>Join</T>
          </Press>
        )
      }
    />
  );
}
