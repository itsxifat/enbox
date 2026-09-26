/**
 * Communities tab (/communities): "New community", then each community with its
 * announcements and the groups I'm in (live previews from the chats store).
 */
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronRight, Plus, UsersRound } from 'lucide-react';
import type { Community } from '@enbox/shared';
import { ICON_STROKE_BOLD } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Avatar, Button, EmptyState, IconButton, ListItemSkeleton, toast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useCommunities, useSortedCommunities } from '@/stores/communities';
import { CommunityChatRow } from './CommunityChatRow';

const GROUPS_PREVIEW = 3;

export function CommunitiesPane() {
  const { communityId } = useParams();
  const navigate = useNavigate();
  const loaded = useCommunities((s) => s.loaded);
  const communities = useSortedCommunities();

  useEffect(() => {
    void useCommunities
      .getState()
      .loadCommunities()
      .catch((e: unknown) => {
        if (!useCommunities.getState().loaded) toast.error(e);
      });
  }, []);

  return (
    <>
      <PaneHeader
        title="Communities"
        large
        actions={
          <IconButton
            icon={Plus}
            label="New community"
            onClick={() => void navigate('/communities/new')}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin">
        <Link
          to="/communities/new"
          className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        >
          <span className="relative flex size-12 shrink-0 items-center justify-center rounded-[28%] bg-surface-2 text-muted">
            <UsersRound size={24} aria-hidden />
            <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-brand text-on-brand ring-2 ring-surface">
              <Plus size={14} strokeWidth={ICON_STROKE_BOLD} aria-hidden />
            </span>
          </span>
          <span className="text-[16px] font-medium text-fg">New community</span>
        </Link>
        {!loaded ? (
          <ListItemSkeleton count={3} />
        ) : communities.length ? (
          communities.map((c) => (
            <CommunityBlock key={c.id} community={c} active={c.id === communityId} />
          ))
        ) : (
          <EmptyState
            icon={UsersRound}
            title="Stay connected with a community"
            description="Communities bring members together in topic-based groups, and make it easy to get admin announcements. Any community you're added to will appear here."
            action={
              <Button onClick={() => void navigate('/communities/new')} leftIcon={Plus}>
                Start your community
              </Button>
            }
          />
        )}
      </div>
    </>
  );
}

function CommunityBlock({ community: c, active }: { community: Community; active: boolean }) {
  const mine = c.groups.filter((g) => !g.isAnnouncement && g.isMember);
  const groupCount = c.groups.filter((g) => !g.isAnnouncement).length;
  return (
    <section className="mt-2 border-t-8 border-app first:border-t-0" aria-label={c.name}>
      <Link
        to={`/communities/${c.id}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 px-4 py-3 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
          active && 'bg-selected hover:bg-selected',
        )}
      >
        <Avatar src={c.avatarUrl} name={c.name} colorSeed={c.id} kind="community" size="lg" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[17px] font-semibold text-fg">{c.name}</span>
          <span className="truncate text-[13px] text-muted">
            {groupCount} {groupCount === 1 ? 'group' : 'groups'} · {c.memberCount}{' '}
            {c.memberCount === 1 ? 'member' : 'members'}
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden />
      </Link>
      <div className="mx-4 h-px bg-line" />
      <CommunityChatRow
        chatId={c.announcementChatId}
        name={c.name}
        avatarUrl={c.avatarUrl}
        announcement
        fallback="Welcome to the community!"
      />
      {mine.slice(0, GROUPS_PREVIEW).map((g) => (
        <CommunityChatRow
          key={g.chatId}
          chatId={g.chatId}
          name={g.name}
          avatarUrl={g.avatarUrl}
          fallback={`${g.memberCount} members`}
        />
      ))}
      <Link
        to={`/communities/${c.id}`}
        className="flex items-center justify-between gap-3 py-3 pr-4 pl-[72px] text-[14.5px] font-medium text-brand-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        {mine.length > GROUPS_PREVIEW
          ? `View all (${mine.length - GROUPS_PREVIEW} more)`
          : groupCount > mine.length
            ? `View all groups (${groupCount - mine.length} to join)`
            : 'View community'}
        <ChevronRight size={18} aria-hidden />
      </Link>
    </section>
  );
}
