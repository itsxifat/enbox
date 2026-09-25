import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, Eye, ImagePlus, Trash2 } from 'lucide-react';
import { AVATAR_MIME_TYPES } from '@enbox/shared';
import { Avatar, Menu, Spinner, confirm, toast, type MenuEntry } from '@/components/ui';
import { PhotoViewer } from '@/features/contacts/PhotoViewer';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { AvatarCropDialog } from './AvatarCropDialog';
import { isAcceptedImage, removeAvatar } from './avatar';

const ACCEPT = [...AVATAR_MIME_TYPES, 'image/gif', 'image/avif', 'image/heic'].join(',');

/**
 * My profile photo with a camera button: view, upload (crop dialog → upload → PATCH /me)
 * or remove. Used by Settings → Profile and the welcome page.
 */
export function AvatarEditor({ size = 160, className }: { size?: number; className?: string }) {
  const me = useMe();
  const inputRef = useRef<HTMLInputElement>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [viewing, setViewing] = useState(false);
  const [removing, setRemoving] = useState(false);
  if (!me) return null;
  const hasPhoto = !!me.avatarUrl;

  const pick = () => inputRef.current?.click();

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!isAcceptedImage(f)) {
      toast.error('Choose a photo (JPEG, PNG or WebP).');
      return;
    }
    setFile(f);
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Remove profile photo?',
      message: 'People will see your initials instead.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await removeAvatar();
      toast.success('Profile photo removed');
    } catch (err) {
      toast.error(err);
    } finally {
      setRemoving(false);
    }
  };

  const items: MenuEntry[] = [
    hasPhoto && { label: 'View photo', icon: Eye, onSelect: () => setViewing(true) },
    { label: hasPhoto ? 'Upload new photo' : 'Upload photo', icon: ImagePlus, onSelect: pick },
    hasPhoto && 'separator',
    hasPhoto && {
      label: 'Remove photo',
      icon: Trash2,
      danger: true,
      onSelect: () => void remove(),
    },
  ];

  const badge = Math.max(36, Math.round(size * 0.27));

  return (
    <div className={cn('relative inline-flex', className)} style={{ width: size, height: size }}>
      <button
        ref={setAnchorEl}
        type="button"
        aria-label={hasPhoto ? 'Change profile photo' : 'Add profile photo'}
        aria-haspopup={hasPhoto ? 'menu' : undefined}
        onClick={() => (hasPhoto ? setMenuOpen(true) : pick())}
        className="group relative rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        <Avatar src={me.avatarUrl} name={me.displayName} colorSeed={me.id} size={size} />
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-black/50 text-[12px] font-semibold tracking-wide text-white uppercase opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera size={Math.round(size * 0.16)} aria-hidden />
          {hasPhoto ? 'Change photo' : 'Add photo'}
        </span>
        {removing ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white">
            <Spinner size={28} />
          </span>
        ) : null}
      </button>
      <span
        className="pointer-events-none absolute right-[2%] bottom-[2%] flex items-center justify-center rounded-full bg-brand text-on-brand shadow-md ring-4 ring-surface"
        style={{ width: badge, height: badge }}
        aria-hidden
      >
        <Camera size={Math.round(badge * 0.48)} />
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={onFile}
        data-testid="avatar-file-input"
      />
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={anchorEl}
        items={items}
        align="start"
        aria-label="Profile photo"
      />
      <AvatarCropDialog file={file} onClose={() => setFile(null)} />
      <PhotoViewer
        open={viewing}
        onClose={() => setViewing(false)}
        src={me.avatarUrl}
        title={me.displayName}
        subtitle="Profile photo"
      />
    </div>
  );
}
