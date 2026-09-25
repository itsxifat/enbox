/** /updates/channels/discover — search the public channel directory, preview and follow. */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Check, Megaphone, Plus, SearchX } from 'lucide-react';
import type { ChannelDirectoryEntry } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  ListItemSkeleton,
  SearchInput,
  toast,
} from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { errorMessage } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { useChats } from '@/stores/chats';
import { discoverChannels, followChannel } from './channelApi';
import { IN_APP_NAV } from '@/components/layout/navigation';

export function ChannelDiscoverPane() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query, 250);
  const [list, setList] = useState<ChannelDirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const followed = useChats((s) => s.byId);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    discoverChannels(q, { limit: 50, signal: ctrl.signal })
      .then((r) => setList(r))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [q]);

  const follow = async (c: ChannelDirectoryEntry) => {
    setBusy(c.id);
    try {
      await followChannel(c.id);
      setList(
        (l) =>
          l?.map((x) =>
            x.id === c.id ? { ...x, isFollowing: true, followerCount: x.followerCount + 1 } : x,
          ) ?? l,
      );
      toast.success(`You're following ${c.name}`, {
        action: { label: 'Open', onClick: () => void navigate(`/updates/channels/${c.id}`) },
      });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <PaneHeader
        title="Find channels"
        subtitle="Public channels on Enbox"
        back={desktop ? undefined : '/updates'}
        border
        actions={
          <IconButton
            icon={Plus}
            label="Create channel"
            onClick={() => void navigate('/updates/channels/new')}
          />
        }
      >
        <div className="mx-auto max-w-3xl">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search channels"
            aria-label="Search channels"
            autoFocus={desktop}
          />
        </div>
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-3xl">
          {list === null && !error ? (
            <ListItemSkeleton count={7} />
          ) : error ? (
            <EmptyState
              compact
              icon={Megaphone}
              title="Couldn't load channels"
              description={error}
            />
          ) : list && list.length ? (
            <ul aria-label="Channels">
              {list.map((c) => {
                const following = c.isFollowing || !!followed[c.id];
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 border-b border-line pr-4 last:border-0 hover:bg-hover"
                  >
                    <Link
                      to={`/updates/channels/${c.id}`}
                      state={IN_APP_NAV}
                      className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                    >
                      <Avatar
                        src={c.avatarUrl}
                        name={c.name}
                        colorSeed={c.id}
                        kind="channel"
                        size="lg"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-medium text-fg">
                          {c.name}
                        </span>
                        <span className="block truncate text-[13.5px] text-muted">
                          {formatCount(c.followerCount)}{' '}
                          {c.followerCount === 1 ? 'follower' : 'followers'}
                          {c.description ? ` · ${c.description}` : ''}
                        </span>
                      </span>
                    </Link>
                    {following ? (
                      <span className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-muted">
                        <Check size={16} aria-hidden /> Following
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="soft"
                        loading={busy === c.id}
                        onClick={() => void follow(c)}
                        aria-label={`Follow ${c.name}`}
                      >
                        Follow
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={q ? SearchX : Megaphone}
              title={q ? 'No channels found' : 'No channels yet'}
              description={
                q
                  ? `No public channel matches “${q}”.`
                  : 'Be the first: create a channel and share updates with your followers.'
              }
              action={
                <Button leftIcon={Plus} onClick={() => void navigate('/updates/channels/new')}>
                  Create channel
                </Button>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
