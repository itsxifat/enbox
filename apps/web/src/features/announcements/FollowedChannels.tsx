/**
 * Integrations ▸ Channels Followed (shown by IntegrationsPage, MANAGE_WEBHOOKS): the
 * announcement channels followed into this Space — the source Space's icon and name, its
 * channel, the channel here they post into — each with Unfollow.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Megaphone } from 'lucide-react';
import type { ChannelFollow, Space } from '@enbox/shared';
import { Button, EmptyState, Spinner, confirm, toast } from '@/components/ui';
import { SpaceIcon } from '@/features/spaces/community/SpaceIcon';
import { errorMessage } from '@/lib/api';
import { listSpaceFollows, unfollowChannel } from './actions';

export function FollowedChannels({ space }: { space: Space }) {
  const [list, setList] = useState<ChannelFollow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    listSpaceFollows(space.id)
      .then(setList)
      .catch((e: unknown) => setError(errorMessage(e, 'Could not load followed channels')));
  }, [space.id]);
  useEffect(() => load(), [load]);

  const unfollow = async (f: ChannelFollow) => {
    const ok = await confirm({
      title: `Unfollow #${f.sourceChannel.name}?`,
      message: `#${f.targetChannel.name} stops getting posts from ${f.sourceChannel.spaceName} #${f.sourceChannel.name}.`,
      confirmLabel: 'Unfollow',
      danger: true,
    });
    if (!ok) return;
    try {
      await unfollowChannel(f.id);
      setList((l) => l?.filter((x) => x.id !== f.id) ?? null);
      toast.success(`Unfollowed #${f.sourceChannel.name}`);
    } catch (e) {
      toast.error(e);
    }
  };

  if (error) return <p className="text-[14px] text-danger">{error}</p>;
  if (!list) return <Spinner />;
  if (list.length === 0)
    return (
      <EmptyState
        icon={Megaphone}
        title="No channels followed yet"
        description="Follow an announcement channel from its header to get its published posts in a channel here."
      />
    );
  return (
    <ul className="card-inset flex flex-col p-1" aria-label="Channels followed">
      {list.map((f) => (
        <li
          key={f.id}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5"
          data-testid="followed-channel"
        >
          <SpaceIcon
            name={f.sourceChannel.spaceName}
            iconUrl={f.sourceChannel.spaceIconUrl}
            size={40}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{f.sourceChannel.spaceName}</p>
            <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
              <span className="truncate">#{f.sourceChannel.name}</span>
              <ArrowRight size={14} className="shrink-0" aria-label="into" />
              <span className="truncate">#{f.targetChannel.name}</span>
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            onClick={() => void unfollow(f)}
          >
            Unfollow
          </Button>
        </li>
      ))}
    </ul>
  );
}
