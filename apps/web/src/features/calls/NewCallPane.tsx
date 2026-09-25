/**
 * New call (/calls/new): pick a contact (voice/video) or a group to call. Contacts without a
 * chat yet get one via `POST /api/chats/direct` first.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Phone, UserRoundSearch, Video } from 'lucide-react';
import { chatTitle, userDisplayName, type Contact, type ID } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { UserAvatar } from '@/components/common/UserAvatar';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  EmptyState,
  ListItem,
  ListItemSkeleton,
  ListSection,
  SearchInput,
  toast,
} from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { api, errorMessage } from '@/lib/api';
import { useBus } from '@/hooks/useBus';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import type { CallType } from '@enbox/shared';
import { ensureDirectChat } from './directChat';

function CallIcons({
  label,
  onCall,
  disabled,
}: {
  label: string;
  onCall: (t: CallType) => void;
  disabled?: boolean;
}) {
  const cls =
    'flex size-10 items-center justify-center rounded-full text-brand-ink transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40';
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        className={cls}
        aria-label={`Voice call ${label}`}
        title="Voice call"
        disabled={disabled}
        onClick={() => onCall('audio')}
      >
        <Phone size={20} aria-hidden />
      </button>
      <button
        type="button"
        className={cls}
        aria-label={`Video call ${label}`}
        title="Video call"
        disabled={disabled}
        onClick={() => onCall('video')}
      >
        <Video size={21} aria-hidden />
      </button>
    </span>
  );
}

export function NewCallPane() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const chats = useChats((s) => s.byId);

  useEffect(() => {
    let alive = true;
    api
      .get<Contact[]>('/api/contacts')
      .then((c) => alive && setContacts(c))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [reload]);
  useBus('contacts:changed', () => setReload((n) => n + 1));

  const q = query.trim().toLowerCase();
  const people = useMemo(
    () =>
      (contacts ?? [])
        .filter((c) => !c.user.isDeleted && !c.user.isBlocked)
        .filter(
          (c) =>
            !q || userDisplayName(c.user).toLowerCase().includes(q) || c.user.username.includes(q),
        )
        .sort((a, b) => userDisplayName(a.user).localeCompare(userDisplayName(b.user))),
    [contacts, q],
  );
  const groups = useMemo(
    () =>
      Object.values(chats)
        .filter((c) => c.type === 'group' && c.membership === 'active' && c.permissions.canCall)
        .filter((c) => !q || chatTitle(c).toLowerCase().includes(q))
        .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1)),
    [chats, q],
  );

  const callUser = async (userId: ID, type: CallType) => {
    try {
      const chat = await ensureDirectChat(userId);
      await useCalls.getState().startCall(chat.id, type);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface" data-testid="new-call">
      <PaneHeader title="New call" back={desktop ? undefined : '/calls'} border={desktop}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search contacts and groups"
          autoFocus={desktop}
        />
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6 scrollbar-thin">
        <div className="mx-auto max-w-2xl">
          {groups.length ? (
            <ListSection title="Groups">
              {groups.slice(0, q ? 50 : 6).map((g) => (
                <ListItem
                  key={g.id}
                  divider={false}
                  leading={<ChatAvatar chat={g} />}
                  title={chatTitle(g)}
                  subtitle={`${g.memberCount} members`}
                  end={
                    <CallIcons
                      label={chatTitle(g)}
                      onCall={(t) => void useCalls.getState().startCall(g.id, t)}
                    />
                  }
                />
              ))}
            </ListSection>
          ) : null}
          <ListSection title="Contacts">
            {error ? (
              <EmptyState title="Couldn't load contacts" description={error} compact />
            ) : !contacts ? (
              <ListItemSkeleton count={6} />
            ) : people.length === 0 ? (
              <EmptyState
                icon={UserRoundSearch}
                title={q ? 'No matches' : 'No contacts yet'}
                description={
                  q ? `Nobody matches "${query.trim()}".` : 'Add contacts to call them from here.'
                }
                compact
                action={
                  q ? undefined : (
                    <button
                      type="button"
                      className="text-[14px] font-semibold text-brand-ink hover:underline"
                      onClick={() => navigate('/new')}
                    >
                      Find people
                    </button>
                  )
                }
              />
            ) : (
              people.map((c) => (
                <ListItem
                  key={c.user.id}
                  divider={false}
                  leading={<UserAvatar user={c.user} size="lg" />}
                  title={userDisplayName(c.user)}
                  subtitle={c.user.about ?? `@${c.user.username}`}
                  end={
                    <CallIcons
                      label={userDisplayName(c.user)}
                      onCall={(t) => void callUser(c.user.id, t)}
                    />
                  }
                />
              ))
            )}
          </ListSection>
        </div>
      </div>
    </div>
  );
}
