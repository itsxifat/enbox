/**
 * The editor's Avatar and Profile Banner fields. Choosing or dropping an image opens the crop
 * dialog, which uploads the media only; the draft keeps it (and Remove) until Save Changes.
 */
import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, ImagePlus } from 'lucide-react';
import { AVATAR_MIME_TYPES, BANNER_MIME_TYPES, type UserSelf } from '@enbox/shared';
import { Avatar, Button, toast } from '@/components/ui';
import { profileGradient } from '@/features/profile/model';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { isAcceptedImage } from './avatar';
import { AvatarCropDialog } from './AvatarCropDialog';
import { isAcceptedBanner } from './banner';
import { BannerCropDialog } from './BannerCropDialog';
import {
  REMOVED_IMAGE,
  draftAvatar,
  draftBanner,
  effectiveDisplayName,
  stagedFromMedia,
  type ProfileDraft,
} from './draft';
import { FormSection } from './FormSection';
import { useImageDrop } from './useImageDrop';
import type { ProfileDraftApi } from './useProfileDraft';

const AVATAR_ACCEPT = [...AVATAR_MIME_TYPES, 'image/gif', 'image/avif', 'image/heic'].join(',');
const BANNER_ACCEPT = [...BANNER_MIME_TYPES, 'image/avif', 'image/heic'].join(',');

interface FieldProps {
  me: UserSelf;
  draft: ProfileDraft;
  set: ProfileDraftApi['set'];
}

export function AvatarField({ me, draft, set }: FieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const { url, animatedUrl } = draftAvatar(me, draft);
  const accept = (f: File) => {
    if (!isAcceptedImage(f)) {
      toast.error('Choose a photo (JPEG, PNG, WebP or GIF).');
      return;
    }
    setFile(f);
  };
  const drop = useImageDrop(accept);
  const pick = () => inputRef.current?.click();
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) accept(f);
  };

  return (
    <FormSection
      title="Avatar"
      hint="Drop an image on your avatar or choose one. Animated GIF, WebP and PNG avatars stay animated."
      testId="avatar-field"
    >
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label={url ? 'Change avatar' : 'Add avatar'}
          onClick={pick}
          {...drop.props}
          data-testid="avatar-drop"
          data-over={drop.over || undefined}
          className={cn(
            'group relative shrink-0 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand',
            drop.over && 'ring-4 ring-brand ring-offset-4 ring-offset-surface',
          )}
        >
          <Avatar
            src={url}
            animatedSrc={animatedUrl}
            animate="always"
            name={effectiveDisplayName(me, draft)}
            colorSeed={me.id}
            size={80}
          />
          <span
            className={cn(
              'absolute inset-0 flex flex-col items-center justify-center rounded-full bg-black/55 text-[10.5px] font-semibold tracking-wide text-white uppercase transition-opacity',
              drop.over
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
            )}
            aria-hidden
          >
            <Camera size={18} />
            {drop.over ? 'Drop' : 'Change'}
          </span>
        </button>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={pick}>
            Change Avatar
          </Button>
          {url ? (
            <Button size="sm" variant="ghost" onClick={() => set('avatar', REMOVED_IMAGE)}>
              Remove Avatar
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="hidden"
        onChange={onFile}
        data-testid="avatar-file-input"
      />
      <AvatarCropDialog
        file={file}
        onClose={() => setFile(null)}
        onUploaded={(media) => set('avatar', stagedFromMedia(media))}
        successToast={null}
      />
    </FormSection>
  );
}

export function BannerField({ me, draft, set }: FieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const { url } = draftBanner(me, draft);
  const accept = (f: File) => {
    if (!isAcceptedBanner(f)) {
      toast.error('Choose an image (JPEG, PNG, WebP or GIF).');
      return;
    }
    setFile(f);
  };
  const drop = useImageDrop(accept);
  const pick = () => inputRef.current?.click();
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) accept(f);
  };
  const src = mediaUrl(url);

  return (
    <FormSection
      title="Profile Banner"
      hint="Drop an image on the banner or choose one. JPEG, PNG, WebP or GIF, cropped to 5:2. Without one your card shows your theme colours."
      testId="banner-field"
    >
      <button
        type="button"
        aria-label={url ? 'Change banner' : 'Add banner'}
        onClick={pick}
        {...drop.props}
        data-testid="banner-drop"
        data-over={drop.over || undefined}
        className={cn(
          'group relative block w-full max-w-md overflow-hidden rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          drop.over && 'ring-4 ring-brand ring-offset-2 ring-offset-surface',
        )}
        style={{
          aspectRatio: '5 / 2',
          background: profileGradient(draft.profileColor, draft.accentColor),
        }}
      >
        {src ? <img src={src} alt="" className="size-full object-cover" draggable={false} /> : null}
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center gap-2 bg-black/50 text-[12px] font-semibold tracking-wide text-white uppercase transition-opacity',
            drop.over
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
          )}
          aria-hidden
        >
          <ImagePlus size={18} />
          {drop.over ? 'Drop to upload' : url ? 'Change banner' : 'Add banner'}
        </span>
      </button>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={pick}>
          Change Banner
        </Button>
        {url ? (
          <Button size="sm" variant="ghost" onClick={() => set('banner', REMOVED_IMAGE)}>
            Remove Banner
          </Button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={BANNER_ACCEPT}
        className="hidden"
        onChange={onFile}
        data-testid="banner-file-input"
      />
      <BannerCropDialog
        file={file}
        onClose={() => setFile(null)}
        onUploaded={(media) => set('banner', stagedFromMedia(media))}
        successToast={null}
      />
    </FormSection>
  );
}
