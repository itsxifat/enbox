/**
 * The one place the profile surfaces are rendered (mounted in AppShell next to the call
 * overlay):
 *
 * - the popout: `bus.emit('profile:open', { userId, anchor, spaceId })` — or `openProfile()` —
 *   shows it; it closes on Escape, outside click, a navigation from inside the card or any
 *   route change;
 * - the full profile modal: `openFullProfile(userId, { spaceId, tab })` (the popout's avatar,
 *   "View Full Profile" and mutuals line use it); it closes on Escape, the backdrop or any
 *   route change. A popout opened from inside it (a mutual friend) stacks above it.
 *
 * The custom-status and contact dialogs live here, outside the popover, since a click inside
 * them would otherwise close it.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import type { UserPublic } from '@enbox/shared';
import { EditContactDialog } from '@/features/contacts/ContactDialogs';
import { useBus } from '@/hooks/useBus';
import type { BusEvents } from '@/lib/bus';
import { FullProfileModal } from './FullProfileModal';
import { closeFullProfile, openFullProfile, useFullProfileRequest } from './open';
import { PresenceNoteDialog } from './PresenceNoteDialog';
import { ProfilePopover } from './ProfilePopover';

export function ProfileCardHost() {
  const [req, setReq] = useState<BusEvents['profile:open'] | null>(null);
  const full = useFullProfileRequest((s) => s.req);
  const [noteOpen, setNoteOpen] = useState(false);
  const [editing, setEditing] = useState<UserPublic | null>(null);
  const { pathname } = useLocation();

  useBus('profile:open', (p) => setReq(p));
  const close = useCallback(() => setReq(null), []);
  // Navigating away (Message, a mutual Space, the browser back button) closes both.
  useEffect(() => {
    setReq(null);
    closeFullProfile();
  }, [pathname]);

  const setStatus = () => {
    setReq(null);
    closeFullProfile();
    setNoteOpen(true);
  };

  return (
    <>
      {full ? (
        <FullProfileModal
          key={full.userId}
          userId={full.userId}
          spaceId={full.spaceId}
          tab={full.tab}
          onClose={closeFullProfile}
          onSetStatus={setStatus}
          onEditContact={setEditing}
        />
      ) : null}
      {req ? (
        <ProfilePopover
          key={req.userId}
          userId={req.userId}
          anchor={req.anchor}
          spaceId={req.spaceId}
          onClose={close}
          onSetStatus={setStatus}
          onEditContact={(u) => {
            setReq(null);
            setEditing(u);
          }}
          onOpenFull={(tab) => {
            setReq(null);
            openFullProfile(req.userId, { spaceId: req.spaceId, tab });
          }}
        />
      ) : null}
      <PresenceNoteDialog open={noteOpen} onClose={() => setNoteOpen(false)} />
      <EditContactDialog user={editing} onClose={() => setEditing(null)} />
    </>
  );
}
