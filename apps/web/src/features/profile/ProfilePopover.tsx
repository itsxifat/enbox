/**
 * The profile card in its container: a ~300px `Popover` beside the trigger on desktop with a
 * fine pointer, otherwise a `Modal` (a sheet on phones; also for `anchor: null`). Loads what
 * the card needs — the full profile on open (fresh bio / colours / pronouns into the users
 * store, the mutual counts and my note), live presence — and my own `UserSelf` for the self
 * card.
 */
import type { ID, UserPublic } from '@enbox/shared';
import { Modal, Popover, Skeleton } from '@/components/ui';
import { useIsDesktop, useMediaQuery } from '@/hooks/useMediaQuery';
import { useMe } from '@/stores/auth';
import { usePresence, useUser } from '@/stores/users';
import { selfCardUser } from './model';
import type { FullProfileTab } from './open';
import { ProfileCard } from './ProfileCard';
import { useUserProfile } from './profileStore';

const FINE_POINTER_QUERY = '(pointer: fine)';

export interface ProfilePopoverProps {
  userId: ID;
  anchor: HTMLElement | { x: number; y: number } | null;
  /** Opened inside a Space: nickname, roles, per-Space profile. */
  spaceId?: ID;
  onClose: () => void;
  /** The host renders these dialogs in place of the card (they outlive it: the card closes when they open). */
  onSetStatus: () => void;
  onEditContact: (user: UserPublic) => void;
  /** Swap the card for the full profile modal. */
  onOpenFull: (tab?: FullProfileTab) => void;
}

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy>
      <Skeleton className="-mx-4 -mt-4 h-[105px] rounded-none" />
      <Skeleton circle className="-mt-12 size-20" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
  );
}

export function ProfilePopover({
  userId,
  anchor,
  spaceId,
  onClose,
  onSetStatus,
  onEditContact,
  onOpenFull,
}: ProfilePopoverProps) {
  const me = useMe();
  const self = !!me && userId === me.id;
  const cached = useUser(self ? null : userId);
  const presence = usePresence(self ? null : userId);
  const desktop = useIsDesktop();
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const asPopover = desktop && finePointer && anchor !== null;
  // Fresh profile on every open (bio / colours / mutuals may have changed since it was cached).
  const { profile } = useUserProfile(self ? null : userId);

  const user = self && me ? selfCardUser(me) : (cached ?? profile?.user);
  const body = user ? (
    <ProfileCard
      user={user}
      presence={self ? undefined : presence}
      self={self}
      spaceId={spaceId}
      profile={self ? undefined : (profile ?? null)}
      onNavigate={onClose}
      onSetStatus={onSetStatus}
      onEditContact={onEditContact}
      onOpenFull={onOpenFull}
    />
  ) : (
    <CardSkeleton />
  );

  if (asPopover)
    return (
      <Popover
        open
        anchor={anchor}
        onClose={onClose}
        placement="right"
        align="start"
        aria-label="Profile"
        className="max-h-[calc(100dvh-16px)] w-[300px] max-w-[calc(100vw-16px)] overflow-x-hidden overflow-y-auto scrollbar-thin"
      >
        {body}
      </Popover>
    );
  // A titled sheet with the usual close button: a phone sheet up to 92dvh tall leaves little
  // backdrop to tap, and touch screen readers need a focusable way out.
  return (
    <Modal open onClose={onClose} size="sm" title="Profile">
      <div className="-mx-6 -my-3">{body}</div>
    </Modal>
  );
}
