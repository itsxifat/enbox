/**
 * Discord's "Select Friends" popout. Three uses:
 * - `create` (Home's "+"): one friend opens our DM ("Create DM"), more make a group DM
 *   ("Create Group DM");
 * - `add` (a group DM's "Add Friends to DM"): friends who aren't in it yet, up to the slots left;
 * - `dm` (a DM's "Add Friends to DM"): a NEW group DM with the two of us and the friends picked.
 * A search box holds the picks as chips (Backspace removes the last); the list has a checkbox
 * per friend (avatar, display name, username). Friends are my contacts (`useContactList`).
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { Check, X } from 'lucide-react';
import {
  GROUP_DM_MAX_MEMBERS,
  userDisplayName,
  type ChatSummary,
  type ID,
  type UserPublic,
} from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ICON_STROKE_BOLD } from '@/components/icons';
import { Button, Popover, Spinner, toast, type PopoverAnchor } from '@/components/ui';
import { useChatMembers } from '@/features/conversation/members';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { matchesUser, useContactList } from '@/stores/contacts';
import { addFriendsToGroupDm, createGroupDm } from './actions';

export type SelectFriendsMode =
  { kind: 'create' } | { kind: 'add'; chat: ChatSummary } | { kind: 'dm'; chat: ChatSummary };

export interface SelectFriendsPopoverProps {
  mode: SelectFriendsMode;
  anchor: PopoverAnchor;
  onClose: () => void;
  placement?: 'bottom' | 'top';
  align?: 'start' | 'end';
}

/** How many friends this pick may add: the cap minus who's already in (me included). */
export function pickLimit(mode: SelectFriendsMode): number {
  const inAlready =
    mode.kind === 'create' ? 1 : mode.kind === 'dm' ? 2 : Math.max(1, mode.chat.memberCount);
  return Math.max(0, GROUP_DM_MAX_MEMBERS - inAlready);
}

/** "You can add N more friends." (or the limit, once reached). */
export function slotsText(left: number): string {
  if (left <= 0) return `This group has a ${GROUP_DM_MAX_MEMBERS} member limit.`;
  return `You can add ${left} more friend${left === 1 ? '' : 's'}.`;
}

function submitLabel(mode: SelectFriendsMode, picked: number): string {
  if (mode.kind === 'add') return 'Add';
  return mode.kind === 'create' && picked <= 1 ? 'Create DM' : 'Create Group DM';
}

export function SelectFriendsPopover({
  mode,
  anchor,
  onClose,
  placement = 'bottom',
  align = 'start',
}: SelectFriendsPopoverProps) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user?.id);
  const { items, loaded } = useContactList();
  // Adding to a group DM: its members are not candidates (wait for the list).
  const members = useChatMembers(mode.kind === 'add' ? mode.chat : undefined);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<UserPublic[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const ready = loaded && (mode.kind !== 'add' || !!members);
  const limit = pickLimit(mode);
  const left = limit - picked.length;
  const friends = useMemo(() => {
    const skip = new Set<ID>(me ? [me] : []);
    if (mode.kind === 'add') for (const m of members ?? []) skip.add(m.user.id);
    if (mode.kind === 'dm' && mode.chat.peer) skip.add(mode.chat.peer.id);
    return items.map((i) => i.user).filter((u) => !skip.has(u.id) && !u.isBlocked && !u.isDeleted);
  }, [items, members, me, mode]);
  const shown = useMemo(() => friends.filter((u) => matchesUser(u, query)), [friends, query]);
  const pickedIds = new Set(picked.map((u) => u.id));

  const toggle = (user: UserPublic) => {
    setPicked((cur) =>
      cur.some((u) => u.id === user.id)
        ? cur.filter((u) => u.id !== user.id)
        : cur.length < limit
          ? [...cur, user]
          : cur,
    );
    setQuery('');
    input.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !query && picked.length) {
      e.preventDefault();
      setPicked((cur) => cur.slice(0, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Enter picks the only match, else creates with what is picked.
      if (query && shown.length === 1) toggle(shown[0]!);
      else void submit();
    }
  };

  const submit = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    const ids = picked.map((u) => u.id);
    try {
      if (mode.kind === 'add') {
        await addFriendsToGroupDm(mode.chat.id, ids);
        onClose();
        return;
      }
      const chat = await createGroupDm(mode.kind === 'dm' ? [mode.chat.peer!.id, ...ids] : ids);
      onClose();
      void navigate(`/chats/${chat.id}`);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const toFriends = () => {
    onClose();
    void navigate('/chats?friends=add');
  };

  let body;
  if (!ready) {
    body = (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  } else if (friends.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
        <p className="text-[15px] text-muted">
          {items.length && mode.kind !== 'create'
            ? 'All your friends are already here.'
            : 'You don’t have any friends to add!'}
        </p>
        <Button variant="soft" onClick={toFriends}>
          Add Friend
        </Button>
      </div>
    );
  } else if (shown.length === 0) {
    body = <p className="px-4 py-8 text-center text-[14px] text-muted">No friends found.</p>;
  } else {
    body = (
      <ul aria-label="Friends" className="flex flex-col gap-0.5">
        {shown.map((u) => {
          const on = pickedIds.has(u.id);
          const full = !on && left <= 0;
          return (
            <li key={u.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={full}
                onClick={() => toggle(u)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="friend-option"
                data-animate-avatars
              >
                <UserAvatar user={u} size={32} />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="truncate text-[15px] font-medium text-fg">
                    {userDisplayName(u)}
                  </span>
                  <span className="truncate text-[13px] text-muted">{u.username}</span>
                </span>
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                    on ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
                  )}
                  aria-hidden
                >
                  {on ? <Check size={14} strokeWidth={ICON_STROKE_BOLD} /> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Popover
      open
      anchor={anchor}
      onClose={onClose}
      placement={placement}
      align={align}
      aria-label="Select Friends"
      className="w-[440px] max-w-[calc(100vw-16px)]"
    >
      <div
        className="flex max-h-[min(560px,calc(100vh-96px))] flex-col"
        data-testid="select-friends"
      >
        <div className="px-4 pt-4 pb-3">
          <h2 className="text-[20px] font-semibold text-fg">Select Friends</h2>
          <p className="mt-0.5 text-[12px] text-muted" data-testid="select-friends-slots">
            {slotsText(left)}
          </p>
          {friends.length || !ready ? (
            <div className="mt-4 flex max-h-28 flex-wrap items-center gap-1 overflow-y-auto rounded-lg bg-surface-2 p-1.5 focus-within:outline-2 focus-within:outline-brand scrollbar-thin">
              {picked.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggle(u)}
                  aria-label={`Remove ${userDisplayName(u)}`}
                  className="flex h-7 max-w-40 items-center gap-1 rounded-md bg-surface px-2 text-[14px] text-fg hover:bg-hover"
                  data-testid="friend-chip"
                >
                  <span className="truncate">{u.username}</span>
                  <X size={14} aria-hidden />
                </button>
              ))}
              <input
                ref={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={picked.length ? '' : 'Type the username of a friend'}
                aria-label="Search friends"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="h-7 min-w-24 flex-1 bg-transparent px-1.5 text-[15px] text-fg outline-none placeholder:text-subtle"
              />
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">{body}</div>
        {friends.length ? (
          <div className="p-4 pt-2">
            <Button
              fullWidth
              onClick={() => void submit()}
              disabled={!picked.length}
              loading={busy}
            >
              {submitLabel(mode, picked.length)}
            </Button>
          </div>
        ) : null}
      </div>
    </Popover>
  );
}
