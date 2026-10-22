import { useId } from 'react';
import { ChevronDown, UserPlus } from 'lucide-react';
import type { UserSettings } from '@enbox/shared';
import { useMe } from '@/stores/auth';
import { updateSettings } from '../settingsApi';
import { SettingsRow } from '../ui';

export type FriendRequestsFrom = UserSettings['friendRequestsFrom'];

export const FRIEND_REQUESTS_FROM_LABELS: Record<FriendRequestsFrom, string> = {
  everyone: 'Everyone',
  spaces: 'People in my Spaces',
  nobody: 'Nobody',
};

/**
 * Settings → Privacy: who can send me friend requests (one row with its picker). Requests I
 * send can always be answered.
 */
export function FriendRequestSettings() {
  const me = useMe();
  const id = useId();
  if (!me) return null;
  return (
    <SettingsRow
      icon={UserPlus}
      title={<label htmlFor={id}>Friend requests</label>}
      description="Who can send you a friend request"
      testId="privacy-friend-requests"
      end={
        <span className="relative flex shrink-0 items-center">
          <select
            id={id}
            value={me.settings.friendRequestsFrom}
            onChange={(e) =>
              void updateSettings({ friendRequestsFrom: e.target.value as FriendRequestsFrom })
            }
            className="cursor-pointer appearance-none rounded-lg bg-surface-2 py-1.5 pr-8 pl-3 text-[14px] font-medium text-fg outline-none focus-visible:outline-2 focus-visible:outline-brand"
          >
            {(Object.keys(FRIEND_REQUESTS_FROM_LABELS) as FriendRequestsFrom[]).map((v) => (
              <option key={v} value={v}>
                {FRIEND_REQUESTS_FROM_LABELS[v]}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-2 text-muted"
            aria-hidden
          />
        </span>
      }
    />
  );
}
