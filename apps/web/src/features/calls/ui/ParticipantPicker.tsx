/**
 * Choose who to ring: starting a call in a group with more than MAX_CALL_PARTICIPANTS − 1
 * other members, or adding people to an ongoing group call.
 */
import { useEffect, useMemo, useState } from 'react';
import { Phone, UserPlus, Video } from 'lucide-react';
import { MAX_CALL_PARTICIPANTS, userDisplayName, type ChatMember } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button, EmptyState, ListItemSkeleton, Modal, SearchInput } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/stores/auth';
import { useCalls, type PickerRequest } from '@/stores/calls';
import { useChat } from '@/stores/chats';
import { isPendingStatus } from '../logic';
import { SelectRow } from './SelectRow';

export function ParticipantPicker({ request }: { request: PickerRequest }) {
  const me = useMe();
  const chat = useChat(request.chatId);
  const active = useCalls((s) => s.active);
  const [members, setMembers] = useState<ChatMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const close = () => useCalls.getState().closePicker();

  useEffect(() => {
    let alive = true;
    setMembers(null);
    setError(null);
    api
      .get<ChatMember[]>(`/api/chats/${request.chatId}/members`)
      .then((m) => alive && setMembers(m))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [request.chatId]);

  const inCall = useMemo(() => {
    if (request.mode !== 'invite' || !active) return new Set<string>();
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

  const toggle = (id: string) =>
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
      size="md"
      bodyClassName="px-0 py-0"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            leftIcon={
              request.mode === 'invite' ? UserPlus : request.type === 'video' ? Video : Phone
            }
            disabled={!selected.length}
            loading={busy}
            onClick={() => void submit()}
          >
            {request.mode === 'invite' ? 'Ring' : 'Call'}
          </Button>
        </>
      }
    >
      <div className="sticky top-0 z-[1] bg-elevated px-5 pb-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search members" autoFocus />
      </div>
      <div className="min-h-48 pb-2">
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
      </div>
    </Modal>
  );
}
