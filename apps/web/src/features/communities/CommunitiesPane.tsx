/**
 * PLACEHOLDER (agent 3 owns this file): Communities tab list (/communities).
 */
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { Plus, UsersRound } from 'lucide-react';
import { Placeholder } from '@/components/common/Placeholder';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Avatar, ListItem, ListItemSkeleton } from '@/components/ui';
import { useCommunities, useSortedCommunities } from '@/stores/communities';

export function CommunitiesPane() {
  const { communityId } = useParams();
  const loaded = useCommunities((s) => s.loaded);
  const communities = useSortedCommunities();
  useEffect(() => {
    if (!useCommunities.getState().loaded)
      void useCommunities
        .getState()
        .loadCommunities()
        .catch(() => undefined);
  }, []);
  return (
    <>
      <PaneHeader title="Communities" large />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <ListItem
          leading={
            <span className="relative flex size-12 items-center justify-center rounded-[28%] bg-surface-2 text-muted">
              <UsersRound size={24} aria-hidden />
              <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-brand text-on-brand ring-2 ring-surface">
                <Plus size={14} strokeWidth={3} aria-hidden />
              </span>
            </span>
          }
          title="New community"
          onClick={() => undefined}
        />
        {!loaded ? (
          <ListItemSkeleton count={3} />
        ) : communities.length ? (
          communities.map((c) => (
            <ListItem
              key={c.id}
              to={`/communities/${c.id}`}
              active={c.id === communityId}
              leading={
                <Avatar
                  src={c.avatarUrl}
                  name={c.name}
                  colorSeed={c.id}
                  kind="community"
                  size="lg"
                />
              }
              title={c.name}
              subtitle={`${c.groups.length} groups · ${c.memberCount} members`}
            />
          ))
        ) : (
          <Placeholder
            icon={UsersRound}
            title="Stay connected with a community"
            description="Communities bring members together in topic-based groups and make it easy to get admin announcements."
            owner="agent 3"
          />
        )}
      </div>
    </>
  );
}
