/**
 * The profile card in its container: a `Popover` beside the trigger on desktop with a fine
 * pointer, otherwise a `Modal` (a sheet on phones; also for `anchor: null`). Loads what the
 * card needs — a forced profile refetch on open (bio / colours / pronouns may have changed
 * since it was cached), live presence, groups in common — and my own `UserSelf` for the
 * self card.
 */
import { useEffect, useState } from 'react';
import type { ChatSummary, ID, UserPublic } from '@enbox/shared';
import { Modal, Popover, Skeleton } from '@/components/ui';
import { useIsDesktop, useMediaQuery } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { useMe } from '@/stores/auth';
import { usePresence, useUser, useUsers } from '@/stores/users';
import { selfCardUser } from './model';
import { ProfileCard } from './ProfileCard';

const FINE_POINTER_QUERY = '(pointer: fine)';

export interface ProfilePopoverProps {
  userId: ID;
  anchor: HTMLElement | { x: number; y: number } | null;
  onClose: () => void;
  /** The host renders these dialogs in place of the card (they outlive it: the card closes when they open). */
  onSetStatus: () => void;
  onEditContact: (user: UserPublic) => void;
}

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy>
      <Skeleton className="-mx-4 -mt-4 h-28 rounded-none" />
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
  onClose,
  onSetStatus,
  onEditContact,
}: ProfilePopoverProps) {
  const me = useMe();
  const self = !!me && userId === me.id;
  const cached = useUser(self ? null : userId);
  const presence = usePresence(self ? null : userId);
  const desktop = useIsDesktop();
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const asPopover = desktop && finePointer && anchor !== null;
  const [common, setCommon] = useState<ChatSummary[] | null>(null);
  const deleted = !!cached?.isDeleted;

  // Fresh profile on open (same as ContactInfoPanel); batched with useUser's own fetch.
  useEffect(() => {
    if (self) return;
    void useUsers
      .getState()
      .fetchUsers([userId], { force: true })
      .catch(() => undefined);
  }, [userId, self]);

  // Groups in common.
  useEffect(() => {
    if (self || deleted) return;
    let alive = true;
    setCommon(null);
    api
      .get<ChatSummary[]>(`/api/users/${userId}/common-groups`)
      .then((list) => alive && setCommon(list))
      .catch(() => alive && setCommon([]));
    return () => {
      alive = false;
    };
  }, [userId, self, deleted]);

  const user = self && me ? selfCardUser(me) : cached;
  const body = user ? (
    <ProfileCard
      user={user}
      presence={self ? undefined : presence}
      self={self}
      commonGroups={self ? undefined : common}
      onNavigate={onClose}
      onSetStatus={onSetStatus}
      onEditContact={onEditContact}
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
        className="max-h-[calc(100dvh-16px)] w-[340px] max-w-[calc(100vw-16px)] overflow-x-hidden overflow-y-auto scrollbar-thin"
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
