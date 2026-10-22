import { useId, useRef } from 'react';
import type { ID, UserPublic } from '@enbox/shared';
import { Portal, useFocusTrap, useOverlay, useScrollLock } from '@/components/ui';
import { FullProfile } from './FullProfile';
import type { FullProfileTab } from './open';

export interface FullProfileModalProps {
  userId: ID;
  spaceId?: ID;
  tab?: FullProfileTab;
  onClose: () => void;
  onSetStatus?: () => void;
  onEditContact?: (user: UserPublic) => void;
}

/**
 * The full profile as a dialog: 600px wide and centred on larger screens, a full-height
 * bottom sheet on phones. Escape (top-most layer only) and the backdrop close it, focus stays
 * inside, and it is labelled by the person's name. Mounted by ProfileCardHost.
 */
export function FullProfileModal({
  userId,
  spaceId,
  tab,
  onClose,
  onSetStatus,
  onEditContact,
}: FullProfileModalProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlay(true, onClose, rootRef);
  useScrollLock(true);
  useFocusTrap(panelRef, true);

  return (
    <Portal>
      <div
        ref={rootRef}
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      >
        <div
          className="absolute inset-0 animate-fade-in bg-overlay"
          aria-hidden
          onMouseDown={onClose}
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-label="Profile"
          tabIndex={-1}
          data-testid="full-profile-modal"
          className="relative flex h-[calc(100dvh-12px)] w-full animate-slide-up flex-col overflow-hidden rounded-t-3xl bg-elevated pb-safe text-fg shadow-elevated outline-none sm:h-auto sm:max-h-[min(92dvh,800px)] sm:w-[600px] sm:max-w-full sm:animate-scale-in sm:rounded-3xl sm:pb-0"
        >
          <div
            className="pointer-events-none absolute top-2 left-1/2 z-20 h-1 w-10 -translate-x-1/2 rounded-full bg-white/70 sm:hidden"
            aria-hidden
          />
          <FullProfile
            userId={userId}
            spaceId={spaceId}
            initialTab={tab}
            variant="modal"
            titleId={titleId}
            onClose={onClose}
            onNavigate={onClose}
            onSetStatus={onSetStatus}
            onEditContact={onEditContact}
          />
        </div>
      </div>
    </Portal>
  );
}
