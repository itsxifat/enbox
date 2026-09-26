import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, Eye, ImagePlus, Trash2 } from 'lucide-react';
import { BANNER_MIME_TYPES } from '@enbox/shared';
import { ICON_STROKE_ON_FILL } from '@/components/icons';
import { Menu, Spinner, confirm, toast, type MenuEntry } from '@/components/ui';
import { PhotoViewer } from '@/features/contacts/PhotoViewer';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { BannerCropDialog } from './BannerCropDialog';
import { isAcceptedBanner, removeBanner } from './banner';

const ACCEPT = [...BANNER_MIME_TYPES, 'image/avif', 'image/heic'].join(',');

/**
 * My profile banner: a BANNER_ASPECT cover area with a camera badge — view, upload (crop
 * dialog → upload → PATCH /me) or remove. Without a banner it shows the profile colour (or
 * the brand colour). The static poster is shown here; the viewer plays an animated banner.
 * Used by Settings → Profile.
 */
export function BannerEditor({ className }: { className?: string }) {
  const me = useMe();
  const inputRef = useRef<HTMLInputElement>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [viewing, setViewing] = useState(false);
  const [removing, setRemoving] = useState(false);
  if (!me) return null;
  const hasBanner = !!me.bannerUrl;

  const pick = () => inputRef.current?.click();

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!isAcceptedBanner(f)) {
      toast.error('Choose an image (JPEG, PNG, WebP or GIF).');
      return;
    }
    setFile(f);
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Remove banner?',
      message: 'Your profile will show your profile colour instead.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await removeBanner();
      toast.success('Banner removed');
    } catch (err) {
      toast.error(err);
    } finally {
      setRemoving(false);
    }
  };

  const items: MenuEntry[] = [
    hasBanner && { label: 'View banner', icon: Eye, onSelect: () => setViewing(true) },
    { label: hasBanner ? 'Upload new banner' : 'Upload banner', icon: ImagePlus, onSelect: pick },
    hasBanner && 'separator',
    hasBanner && {
      label: 'Remove banner',
      icon: Trash2,
      danger: true,
      onSelect: () => void remove(),
    },
  ];

  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-2xl', className)}
      style={{ aspectRatio: '5 / 2' }}
    >
      <button
        ref={setAnchorEl}
        type="button"
        aria-label={hasBanner ? 'Change banner' : 'Add banner'}
        aria-haspopup={hasBanner ? 'menu' : undefined}
        onClick={() => (hasBanner ? setMenuOpen(true) : pick())}
        className="group absolute inset-0 block size-full outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
        style={{ backgroundColor: me.profileColor ?? 'var(--brand)' }}
      >
        {hasBanner ? (
          <img
            src={mediaUrl(me.bannerUrl)}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 text-[12px] font-semibold tracking-wide text-white uppercase opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera size={20} aria-hidden />
          {hasBanner ? 'Change banner' : 'Add banner'}
        </span>
        {removing ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
            <Spinner size={28} />
          </span>
        ) : null}
      </button>
      <span
        className="pointer-events-none absolute right-3 bottom-3 flex size-9 items-center justify-center rounded-full bg-brand text-on-brand shadow-md ring-4 ring-surface"
        aria-hidden
      >
        <Camera size={18} strokeWidth={ICON_STROKE_ON_FILL} />
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={onFile}
        data-testid="banner-file-input"
      />
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={anchorEl}
        items={items}
        align="end"
        aria-label="Profile banner"
      />
      <BannerCropDialog file={file} onClose={() => setFile(null)} />
      <PhotoViewer
        open={viewing}
        onClose={() => setViewing(false)}
        src={me.bannerUrl}
        animatedSrc={me.bannerAnimatedUrl}
        title={me.displayName}
        subtitle="Profile banner"
        banner
      />
    </div>
  );
}
