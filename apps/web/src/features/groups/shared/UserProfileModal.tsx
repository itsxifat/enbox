/**
 * Legacy entry point of the member lists' "View" action. The quick card is now the app-wide
 * profile card (features/profile, opened through the bus): this forwards a `userId` to it and
 * reports itself closed right away. Prefer `openProfile(userId, anchor)` in new code.
 */
import { useEffect } from 'react';
import type { ID } from '@enbox/shared';
import { openProfile } from '@/features/profile/open';

export function UserProfileModal({ userId, onClose }: { userId: ID | null; onClose: () => void }) {
  useEffect(() => {
    if (!userId) return;
    openProfile(userId, null);
    onClose();
  }, [userId, onClose]);
  return null;
}
