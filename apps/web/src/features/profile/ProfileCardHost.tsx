/**
 * The one place the profile card is rendered (mounted in AppShell next to the call overlay).
 * `bus.emit('profile:open', { userId, anchor })` — or `openProfile()` — shows it; it closes
 * on Escape, outside click, a navigation from inside the card or any route change. The
 * custom-status and contact dialogs live here, outside the popover, since a click inside
 * them would otherwise close it.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import type { UserPublic } from '@enbox/shared';
import { EditContactDialog } from '@/features/contacts/ContactDialogs';
import { useBus } from '@/hooks/useBus';
import type { BusEvents } from '@/lib/bus';
import { PresenceNoteDialog } from './PresenceNoteDialog';
import { ProfilePopover } from './ProfilePopover';

export function ProfileCardHost() {
  const [req, setReq] = useState<BusEvents['profile:open'] | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [editing, setEditing] = useState<UserPublic | null>(null);
  const { pathname } = useLocation();

  useBus('profile:open', (p) => setReq(p));
  const close = useCallback(() => setReq(null), []);
  // Navigating away (Message, a group in common, the browser back button) closes the card.
  useEffect(() => setReq(null), [pathname]);

  return (
    <>
      {req ? (
        <ProfilePopover
          key={req.userId}
          userId={req.userId}
          anchor={req.anchor}
          onClose={close}
          onSetStatus={() => {
            setReq(null);
            setNoteOpen(true);
          }}
          onEditContact={(u) => {
            setReq(null);
            setEditing(u);
          }}
        />
      ) : null}
      <PresenceNoteDialog open={noteOpen} onClose={() => setNoteOpen(false)} />
      <EditContactDialog user={editing} onClose={() => setEditing(null)} />
    </>
  );
}
