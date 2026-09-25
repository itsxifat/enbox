/** Quick profile card for a member (group/community/channel member lists). */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AtSign, MessageCircle, Phone, Info } from 'lucide-react';
import { userDisplayName, type ID } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button, Modal, toast } from '@/components/ui';
import { formatLastSeen } from '@/lib/format';
import { getMyId } from '@/stores/auth';
import { usePresence, useUser } from '@/stores/users';
import { openDirectChat } from './chatActions';

export function UserProfileModal({ userId, onClose }: { userId: ID | null; onClose: () => void }) {
  const user = useUser(userId);
  const presence = usePresence(userId);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!userId) return null;
  const me = getMyId() === userId;
  const name = userDisplayName(user);

  const message = async () => {
    setBusy(true);
    try {
      const chat = await openDirectChat(userId);
      onClose();
      void navigate(`/chats/${chat.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const lastSeen = formatLastSeen(presence);
  return (
    <Modal open onClose={onClose} size="sm" aria-label={name} hideClose={false}>
      <div className="flex flex-col items-center pb-2 text-center">
        <UserAvatar user={user} userId={userId} size="2xl" />
        <h2 className="mt-4 text-xl font-semibold text-fg">{name}</h2>
        {user?.contactName && user.contactName !== user.displayName ? (
          <p className="text-[14px] text-muted">~{user.displayName}</p>
        ) : null}
        {lastSeen ? <p className="mt-0.5 text-[13px] text-subtle">{lastSeen}</p> : null}
      </div>
      <dl className="mt-3 flex flex-col gap-3 rounded-2xl bg-surface-2 p-4 text-left">
        {user?.username ? <Row icon={AtSign} label="Username" value={`@${user.username}`} /> : null}
        {user?.about ? <Row icon={Info} label="About" value={user.about} /> : null}
        {user?.phone ? <Row icon={Phone} label="Phone" value={user.phone} /> : null}
      </dl>
      {!me && !user?.isDeleted ? (
        <div className="mt-4 flex justify-center pb-2">
          <Button leftIcon={MessageCircle} onClick={() => void message()} loading={busy} fullWidth>
            Message {name.split(' ')[0]}
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Info; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0">
        <dt className="text-[12px] text-muted">{label}</dt>
        <dd className="text-[15px] break-words text-fg">{value}</dd>
      </div>
    </div>
  );
}
