/**
 * Choose who to ring (web features/calls/ui/ParticipantPicker.tsx): starting a call in a big
 * group, or adding people to an ongoing group call.
 */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { UserPlus } from 'lucide-react-native';
import { MAX_CALL_PARTICIPANTS, userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { PhoneIcon, VideoIcon } from '@/components/icons';
import {
  Button,
  CheckCircle,
  EmptyState,
  ListItemSkeleton,
  Modal,
  Press,
  SearchInput,
  T,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChat } from '@/stores/chats';
import { useTheme } from '@/theme';
import { isPendingStatus } from '../logic';

/** A multi-select list row (WhatsApp picker style). */
export function SelectRow({ checked, onChange, leading, title, subtitle, disabled }) {
  const { tw } = useTheme();
  return (
    <Press
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[tw`flex-row items-center gap-3 px-5 py-2`, disabled ? { opacity: 0.5 } : null]}
    >
      {leading}
      <View style={tw`min-w-0 flex-1`}>
        <T numberOfLines={1} style={tw`text-[15.5px] font-medium`}>
          {title}
        </T>
        {subtitle ? (
          <T numberOfLines={1} style={tw`text-[13px] text-muted`}>
            {subtitle}
          </T>
        ) : null}
      </View>
      <CheckCircle checked={checked} size={20} />
    </Press>
  );
}

export function ParticipantPicker({ request }) {
  const { tw } = useTheme();
  const me = useMe();
  const chat = useChat(request.chatId);
  const active = useCalls((s) => s.active);
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const close = () => useCalls.getState().closePicker();

  useEffect(() => {
    let alive = true;
    setMembers(null);
    setError(null);
    api
      .get(`/api/chats/${request.chatId}/members`)
      .then((m) => alive && setMembers(m))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [request.chatId]);

  const inCall = useMemo(() => {
    if (request.mode !== 'invite' || !active) return new Set();
    return new Set(
      active.call.participants
        .filter((p) => p.status === 'joined' || isPendingStatus(p.status))
        .map((p) => p.userId),
    );
  }, [request.mode, active]);

  const max =
    request.mode === 'invite'
      ? Math.max(0, MAX_CALL_PARTICIPANTS - inCall.size)
      : MAX_CALL_PARTICIPANTS - 1;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members ?? [])
      .filter((m) => m.user.id !== me?.id && !m.user.isDeleted)
      .filter(
        (m) =>
          !q || userDisplayName(m.user).toLowerCase().includes(q) || m.user.username.includes(q),
      )
      .sort((a, b) => userDisplayName(a.user).localeCompare(userDisplayName(b.user)));
  }, [members, query, me?.id]);

  const toggle = (id) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length >= max ? s : [...s, id],
    );

  const submit = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      close();
      if (request.mode === 'invite') await useCalls.getState().inviteToCall(selected);
      else await useCalls.getState().startCall(request.chatId, request.type, selected);
    } finally {
      setBusy(false);
    }
  };

  const title =
    request.mode === 'invite'
      ? 'Add participants'
      : request.type === 'video'
        ? 'New group video call'
        : 'New group voice call';
  return (
    <Modal
      open
      onClose={close}
      title={title}
      description={
        max > 0
          ? `${chat?.name ?? 'Group'} · select up to ${max} ${max === 1 ? 'person' : 'people'} (${selected.length}/${max})`
          : 'This call is full'
      }
      bodyStyle={tw`px-0 py-0`}
      footer={
        <>
          <Button variant="ghost" onPress={close}>
            Cancel
          </Button>
          <Button
            leftIcon={
              request.mode === 'invite'
                ? UserPlus
                : request.type === 'video'
                  ? VideoIcon
                  : PhoneIcon
            }
            disabled={!selected.length}
            loading={busy}
            onPress={() => void submit()}
          >
            {request.mode === 'invite' ? 'Ring' : 'Call'}
          </Button>
        </>
      }
    >
      <View style={tw`px-5 pb-2`}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search members" />
      </View>
      <View style={tw`min-h-48 pb-2`}>
        {error ? (
          <EmptyState title="Couldn't load members" description={error} compact />
        ) : !members ? (
          <ListItemSkeleton count={5} />
        ) : !list.length ? (
          <EmptyState title="No members found" compact />
        ) : request.mode === 'invite' && list.every((m) => inCall.has(m.user.id)) && !query ? (
          <EmptyState
            title="Everyone is already in the call"
            description="All members of this group have joined or are being called."
            compact
          />
        ) : (
          list.map((m) => {
            const already = inCall.has(m.user.id);
            const checked = already || selected.includes(m.user.id);
            const full = !checked && selected.length >= max;
            return (
              <SelectRow
                key={m.user.id}
                checked={checked}
                disabled={already || full}
                onChange={() => toggle(m.user.id)}
                leading={<UserAvatar user={m.user} size="md" />}
                title={userDisplayName(m.user)}
                subtitle={already ? 'In the call' : (m.user.about ?? undefined)}
              />
            );
          })
        )}
      </View>
    </Modal>
  );
}
