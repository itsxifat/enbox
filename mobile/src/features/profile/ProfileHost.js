/**
 * The one place the profile card is rendered (web ProfileCardHost + ProfilePopover, in its
 * phone form: a titled bottom sheet). `openProfile(userId)` shows it; it closes on back, a
 * navigation from inside the card or any route change. It loads what the card needs — a
 * forced profile refetch, live presence, groups in common — and my own `UserSelf` for the
 * self card. The custom-status and contact dialogs live here too, outside the sheet.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { usePathname } from 'expo-router';
import { Modal, Skeleton } from '@/components/ui';
import { EditContactDialog } from '@/features/contacts/ContactDialogs';
import { useBus } from '@/hooks/useBus';
import { api } from '@/lib/api';
import { useMe } from '@/stores/auth';
import { usePresence, useUser, useUsers } from '@/stores/users';
import { useTheme } from '@/theme';
import { selfCardUser } from './model';
import { PresenceNoteDialog } from './PresenceNoteDialog';
import { ProfileCard } from './ProfileCard';

function CardSkeleton() {
  const { tw } = useTheme();
  return (
    <View style={tw`gap-3 p-4`}>
      <Skeleton style={[tw`-mx-4 -mt-4 h-28`, { borderRadius: 0 }]} />
      <Skeleton circle style={tw`-mt-12 size-20`} />
      <Skeleton style={tw`h-5 w-40`} />
      <Skeleton style={tw`h-3.5 w-24`} />
      <Skeleton style={tw`h-10 w-full rounded-xl`} />
    </View>
  );
}

function ProfileSheet({ userId, onClose, onSetStatus, onEditContact }) {
  const { tw } = useTheme();
  const me = useMe();
  const self = !!me && userId === me.id;
  const cached = useUser(self ? null : userId);
  const presence = usePresence(self ? null : userId);
  const [common, setCommon] = useState(null);
  const [open, setOpen] = useState(true);
  const deleted = !!cached?.isDeleted;

  useEffect(() => {
    if (self) return;
    void useUsers
      .getState()
      .fetchUsers([userId], { force: true })
      .catch(() => undefined);
  }, [userId, self]);

  useEffect(() => {
    if (self || deleted) return;
    let alive = true;
    setCommon(null);
    api
      .get(`/api/users/${userId}/common-groups`)
      .then((list) => alive && setCommon(list))
      .catch(() => alive && setCommon([]));
    return () => {
      alive = false;
    };
  }, [userId, self, deleted]);

  // Animate out, then unmount.
  const close = useCallback(() => {
    setOpen(false);
    setTimeout(onClose, 180);
  }, [onClose]);

  const user = self && me ? selfCardUser(me) : cached;
  return (
    <Modal open={open} onClose={close} title="Profile" bodyStyle={tw`px-0 py-0`}>
      {user ? (
        <ProfileCard
          user={user}
          presence={self ? undefined : presence}
          self={self}
          commonGroups={self ? undefined : common}
          onNavigate={close}
          onSetStatus={onSetStatus}
          onEditContact={onEditContact}
        />
      ) : (
        <CardSkeleton />
      )}
    </Modal>
  );
}

export function ProfileHost() {
  const [req, setReq] = useState(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const pathname = usePathname();

  useBus('profile:open', (p) => setReq({ ...p, key: Date.now() }));
  const close = useCallback(() => setReq(null), []);
  useEffect(() => setReq(null), [pathname]);

  return (
    <>
      {req ? (
        <ProfileSheet
          key={req.key}
          userId={req.userId}
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
