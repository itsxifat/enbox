import { ArrowDownToLine, Mic, UserRound } from 'lucide-react';
import type { VoiceState } from '@enbox/shared';
import type { MenuEntry } from '@/components/ui';
import { tidy } from '@/features/spaces/menus';

/**
 * The right-click menu of someone on a Stage: their profile, and for Stage moderators "Invite
 * to Speak" (audience) or "Move to Audience" (speakers). On my own tile, "Move to Audience"
 * is there for anyone (stepping down) and "Become a Speaker" for moderators.
 */
export function stageMemberMenuItems(o: {
  state: VoiceState;
  /** I moderate this Stage (`isStageModerator`). */
  moderator: boolean;
  /** The tile is mine. */
  self: boolean;
  onProfile: () => void;
  onInvite: () => void;
  onAudience: () => void;
}): MenuEntry[] {
  const audience = !!o.state.suppressed;
  const canInvite = audience && o.moderator;
  const canMoveDown = !audience && (o.moderator || o.self);
  return tidy([
    { label: 'Profile', icon: UserRound, onSelect: o.onProfile },
    (canInvite || canMoveDown) && 'separator',
    canInvite && { label: o.self ? 'Become a Speaker' : 'Invite to Speak', icon: Mic, onSelect: o.onInvite },
    canMoveDown && { label: 'Move to Audience', icon: ArrowDownToLine, onSelect: o.onAudience },
  ]);
}
