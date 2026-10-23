/**
 * /you/friends — the Friends page full screen on phones (Online / All / Pending / Blocked /
 * Add Friend; `?friends=pending` opens a tab), with a Back arrow to the You tab. Desktop:
 * Friends is Home's main view, so this goes to /chats (keeping `?friends=`).
 */
import { Navigate, useLocation } from 'react-router';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { FullView } from '@/components/layout/SplitView';
import { FriendsPage } from '@/features/home/FriendsPage';
import { useIsDesktop } from '@/hooks/useMediaQuery';

export function PhoneFriendsPage() {
  const desktop = useIsDesktop();
  const { search } = useLocation();
  if (desktop) return <Navigate to={`/chats${search}`} replace />;
  return (
    <FullView>
      <PaneHeader title="Friends" back="/you" />
      {/* FriendsPage's tab row is laid out for desktop: on a phone it scrolls sideways. */}
      <div className="flex min-h-0 flex-1 flex-col [&_[data-testid=friends-page]>header]:overflow-x-auto [&_[data-testid=friends-page]>header]:scrollbar-none">
        <FriendsPage />
      </div>
    </FullView>
  );
}
