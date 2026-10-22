import { AtSign, Ban, Ellipsis, Fingerprint, IdCard, Pencil, UserPlus } from 'lucide-react';
import type { UserPublic } from '@enbox/shared';
import { PhoneIcon, VideoIcon } from '@/components/icons';
import { DropdownMenu, IconButton, toast, type IconButtonVariant, type MenuEntry } from '@/components/ui';
import { confirmBlock, confirmUnblock } from '@/features/contacts/contactActions';
import { friendMenuItems } from '@/features/home/friendActions';
import { useFriendStatus } from '@/stores/friends';

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error("Couldn't copy to the clipboard");
  }
}

/**
 * The "..." menu of someone's profile: View Full Profile (popout only), the friend action
 * (Add Friend, Accept / Ignore, Cancel Request or Remove Friend), add / edit contact,
 * calls, Copy Username, Copy User ID and Block / Unblock (the existing contact actions).
 */
export function ProfileMoreMenu({
  user,
  onViewFull,
  onEditContact,
  canCall,
  onCall,
  variant = 'glass',
}: {
  user: UserPublic;
  onViewFull?: () => void;
  onEditContact?: (user: UserPublic) => void;
  canCall?: boolean;
  onCall?: (type: 'audio' | 'video') => void;
  variant?: IconButtonVariant;
}) {
  const friend = useFriendStatus(user);
  const head: MenuEntry[] = [
    onViewFull && { label: 'View Full Profile', icon: IdCard, onSelect: onViewFull },
    ...friendMenuItems(user, friend),
    onEditContact && {
      label: user.isContact ? 'Edit contact' : 'Add to contacts',
      icon: user.isContact ? Pencil : UserPlus,
      onSelect: () => onEditContact(user),
    },
    canCall && onCall && { label: 'Voice call', icon: PhoneIcon, onSelect: () => onCall('audio') },
    canCall && onCall && { label: 'Video call', icon: VideoIcon, onSelect: () => onCall('video') },
  ].filter(Boolean);
  const items: MenuEntry[] = [
    ...head,
    head.length > 0 && 'separator',
    { label: 'Copy Username', icon: AtSign, onSelect: () => void copy(user.username, 'Username copied') },
    { label: 'Copy User ID', icon: Fingerprint, onSelect: () => void copy(user.id, 'User ID copied') },
    'separator',
    user.isBlocked
      ? { label: 'Unblock', icon: Ban, onSelect: () => void confirmUnblock(user) }
      : { label: 'Block', icon: Ban, danger: true, onSelect: () => void confirmBlock(user) },
  ];
  return (
    <DropdownMenu
      aria-label="More"
      items={items}
      trigger={(p) => <IconButton {...p} icon={Ellipsis} label="More" size="sm" variant={variant} />}
    />
  );
}
