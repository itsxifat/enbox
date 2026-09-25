/**
 * "Channels" section of the Updates tab: followed channels (live from the chats store) and,
 * while you follow only a few, suggestions from the public directory with Follow buttons.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BellOff, Compass, Plus, Megaphone } from 'lucide-react';
import { chatTitle, isMuted, messagePreviewText, type ChannelDirectoryEntry } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  IconButton,
  ListItem,
  ListSection,
  toast,
} from '@/components/ui';
import { formatChatListTime, formatCount } from '@/lib/format';
import { isChatUnread, useChats, useSortedChats } from '@/stores/chats';
import { nameOf } from '@/stores/users';
import { discoverChannels, followChannel } from './channelApi';
import { IN_APP_NAV } from '@/components/layout/navigation';

const SUGGEST_WHEN_FEWER_THAN = 4;

export function ChannelsSection() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const channels = useSortedChats({ kind: 'channels' });
  const loaded = useChats((s) => s.loaded);

  return (
    <ListSection
      title="Channels"
      action={
        <DropdownMenu
          aria-label="Channel actions"
          items={[
            {
              label: 'Create channel',
              icon: Plus,
              onSelect: () => void navigate('/updates/channels/new'),
            },
            {
              label: 'Explore channels',
              icon: Compass,
              onSelect: () => void navigate('/updates/channels/discover'),
            },
          ]}
          trigger={(t) => (
            <IconButton
              {...t}
              icon={Plus}
              label="New channel or explore"
              size="sm"
              variant="solid"
            />
          )}
        />
      }
    >
      {channels.length ? (
        <ul aria-label="Followed channels">
          {channels.map((c) => {
            const unread = isChatUnread(c);
            const muted = isMuted(c.mutedUntil);
            return (
              <li key={c.id}>
                <ListItem
                  to={`/updates/channels/${c.id}`}
                  linkState={IN_APP_NAV}
                  active={c.id === chatId}
                  leading={<ChatAvatar chat={c} size="lg" />}
                  title={chatTitle(c)}
                  subtitle={
                    c.lastMessage
                      ? messagePreviewText(c.lastMessage, (id) => nameOf(id), {
                          chatKind: 'channel',
                        })
                      : (c.description ?? 'No posts yet')
                  }
                  meta={formatChatListTime(c.lastActivityAt)}
                  highlight={unread && !muted}
                  trailing={
                    <>
                      {muted ? <BellOff size={15} aria-label="Muted" /> : null}
                      {unread ? (
                        <Badge
                          count={c.unreadCount || undefined}
                          dot={!c.unreadCount}
                          tone={muted ? 'muted' : 'brand'}
                          size="sm"
                          label={`${c.unreadCount} new posts`}
                        />
                      ) : null}
                    </>
                  }
                />
              </li>
            );
          })}
        </ul>
      ) : loaded ? (
        <p className="px-4 pt-1 pb-2 text-[14px] leading-relaxed text-muted">
          Stay updated on topics that matter to you. Find channels to follow below.
        </p>
      ) : null}
      {loaded && channels.length < SUGGEST_WHEN_FEWER_THAN ? <Suggestions /> : null}
      <div className="flex gap-2 px-4 pt-2 pb-3">
        <Link
          to="/updates/channels/discover"
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-soft px-4 text-[14px] font-semibold text-brand-ink hover:brightness-95"
        >
          <Compass size={17} aria-hidden /> Explore channels
        </Link>
      </div>
    </ListSection>
  );
}

function Suggestions() {
  const [list, setList] = useState<ChannelDirectoryEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const followed = useChats((s) => s.byId);

  useEffect(() => {
    const ctrl = new AbortController();
    discoverChannels('', { limit: 12, signal: ctrl.signal })
      .then(setList)
      .catch(() => setList([]));
    return () => ctrl.abort();
  }, []);

  const items = (list ?? []).filter((c) => !c.isFollowing && !followed[c.id]).slice(0, 5);
  if (!items.length) return null;

  const follow = async (c: ChannelDirectoryEntry) => {
    setBusy(c.id);
    try {
      await followChannel(c.id);
      toast.success(`You're following ${c.name}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Find channels to follow" className="pt-1">
      <h4 className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[13px] font-medium text-muted">
        <Megaphone size={14} aria-hidden /> Find channels to follow
      </h4>
      <ul>
        {items.map((c) => (
          <li key={c.id} className="flex items-center gap-3 pr-4 transition-colors hover:bg-hover">
            <Link
              to={`/updates/channels/${c.id}`}
              state={IN_APP_NAV}
              className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand lg:pl-3.5"
            >
              <Avatar src={c.avatarUrl} name={c.name} colorSeed={c.id} kind="channel" size="lg" />
              <span className="min-w-0">
                <span className="block truncate text-[16px] font-medium text-fg">{c.name}</span>
                <span className="block truncate text-[14px] text-muted">
                  {formatCount(c.followerCount)} {c.followerCount === 1 ? 'follower' : 'followers'}
                </span>
              </span>
            </Link>
            <Button
              size="sm"
              variant="soft"
              loading={busy === c.id}
              onClick={() => void follow(c)}
              aria-label={`Follow ${c.name}`}
            >
              Follow
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
