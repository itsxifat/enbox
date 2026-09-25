/**
 * PLACEHOLDER (agent 4 owns this file): the "Status" section of the Updates tab — my
 * status + recent/viewed updates from `useStatus().feed`. Viewer/composer are agent 4's.
 */
import { Plus } from 'lucide-react';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ListItem, ListSection } from '@/components/ui';
import { formatRelativeShort } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useStatus } from '@/stores/status';
import { userDisplayName } from '@enbox/shared';

export function StatusSection() {
  const me = useMe();
  const feed = useStatus((s) => s.feed);
  const mine = feed?.mine ?? [];
  return (
    <ListSection title="Status">
      <ListItem
        onClick={() => undefined}
        divider={false}
        leading={
          <span className="relative inline-flex">
            <UserAvatar
              user={me ? { ...me, contactName: null } : null}
              size="lg"
              ring={mine.length ? 'seen' : null}
            />
            {!mine.length ? (
              <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-brand text-on-brand ring-2 ring-surface">
                <Plus size={14} strokeWidth={3} aria-hidden />
              </span>
            ) : null}
          </span>
        }
        title="My status"
        subtitle={
          mine.length
            ? formatRelativeShort(mine[mine.length - 1]!.createdAt)
            : 'Tap to add status update'
        }
      />
      {feed?.updates.map((item) => (
        <ListItem
          key={item.user.id}
          onClick={() => undefined}
          divider={false}
          leading={
            <UserAvatar user={item.user} size="lg" ring={item.allViewed ? 'seen' : 'unseen'} />
          }
          title={userDisplayName(item.user)}
          subtitle={formatRelativeShort(item.lastUpdatedAt)}
        />
      ))}
    </ListSection>
  );
}
