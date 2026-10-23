/**
 * The Friends entry for the top of the phone Messages list (Discord mobile): opens the Friends
 * page, with the pending requests count. Nothing on desktop, where Friends heads the Home
 * sidebar. Styled like the list's Archived entry.
 */
import { Link } from 'react-router';
import { ChevronRight, Users } from 'lucide-react';
import { IN_APP_NAV } from '@/components/layout/navigation';
import { Badge } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useIncomingFriendRequestCount } from '@/stores/friends';

export function FriendsEntry() {
  const desktop = useIsDesktop();
  const requests = useIncomingFriendRequestCount();
  if (desktop) return null;
  return (
    <Link
      to="/you/friends"
      state={IN_APP_NAV}
      className="mx-2 my-0.5 flex items-center gap-4 rounded-xl px-4 py-3 text-[15px] font-medium text-fg outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      data-testid="messages-friends-entry"
    >
      <Users size={20} className="text-brand-ink" aria-hidden />
      <span className="flex-1">Friends</span>
      {requests ? (
        <Badge
          count={requests}
          size="sm"
          tone="danger"
          label={`${requests} pending friend request${requests === 1 ? '' : 's'}`}
        />
      ) : null}
      <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden />
    </Link>
  );
}
