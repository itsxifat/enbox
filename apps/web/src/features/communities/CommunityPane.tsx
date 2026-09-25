/** PLACEHOLDER (agent 3 owns this file): community home (/communities/:communityId). */
import { useParams } from 'react-router';
import { UsersRound } from 'lucide-react';
import { Placeholder } from '@/components/common/Placeholder';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useCommunities } from '@/stores/communities';

export function CommunityPane() {
  const { communityId } = useParams();
  const desktop = useIsDesktop();
  const community = useCommunities((s) => (communityId ? s.byId[communityId] : undefined));
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <PaneHeader
        title={community?.name ?? 'Community'}
        back={desktop ? undefined : '/communities'}
        border
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Placeholder
          icon={UsersRound}
          title="Community home"
          description="Announcements, groups you're in and groups you can join."
          owner="agent 3"
        />
      </div>
    </div>
  );
}
