/**
 * Avatar with a camera badge: pick an image → crop → upload (re-encoded JPEG) → `onUploaded`.
 * With a current photo and `onRemove`, a menu offers "Change" / "Remove". Used for group,
 * community and channel icons (creation flows and info panels).
 */
import { useRef, useState } from 'react';
import { Camera, ImageUp, Trash2 } from 'lucide-react';
import { AVATAR_MIME_TYPES, type MediaAttachment } from '@enbox/shared';
import { ICON_STROKE_ON_FILL } from '@/components/icons';
import { Avatar, Menu, toast, type AvatarKind } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { readImageDimensions } from '@/lib/media';
import { AvatarCropModal } from './AvatarCropModal';

export interface EditableAvatarProps {
  src: string | null | undefined;
  name: string;
  colorSeed?: string;
  kind: AvatarKind;
  /** Pixel size. */
  size: number;
  /** When false, renders a plain avatar. */
  editable?: boolean;
  onUploaded: (media: MediaAttachment) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  /** Accessible label of the button, e.g. "Change group icon". */
  label: string;
  className?: string;
}

const ACCEPT = [...AVATAR_MIME_TYPES, 'image/gif', 'image/avif', 'image/heic'].join(',');

export function EditableAvatar({
  src,
  name,
  colorSeed,
  kind,
  size,
  editable = true,
  onUploaded,
  onRemove,
  label,
  className,
}: EditableAvatarProps) {
  const input = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const avatar = (
    <Avatar
      src={src}
      name={name || 'New'}
      colorSeed={colorSeed}
      kind={kind}
      size={size}
      decorative
    />
  );
  if (!editable) return <span className={className}>{avatar}</span>;

  const pick = () => input.current?.click();

  const upload = async (blob: Blob) => {
    setFile(null);
    setProgress(0);
    try {
      const dims = await readImageDimensions(blob).catch(() => null);
      const media = await api.upload(
        blob,
        { kind: 'image', width: dims?.width, height: dims?.height },
        (p) => setProgress(p),
        { fileName: 'icon.jpg' },
      );
      await onUploaded(media);
    } catch (e) {
      toast.error(e);
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const radius = kind === 'community' ? 'rounded-[28%]' : 'rounded-full';

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={busy}
        onClick={(e) => (src && onRemove ? setAnchor(e.currentTarget) : pick())}
        className={cn(
          'group/av relative inline-flex shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand',
          radius,
          className,
        )}
        style={{ width: size, height: size }}
      >
        {avatar}
        <span
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 text-[11px] font-semibold tracking-wide text-white uppercase opacity-0 transition-opacity group-hover/av:opacity-100 group-focus-visible/av:opacity-100',
            radius,
            busy && 'opacity-100',
          )}
          aria-hidden
        >
          {busy ? (
            <ProgressRing value={progress ?? 0} size={Math.min(56, size * 0.45)} />
          ) : size >= 96 ? (
            <>
              <Camera size={22} />
              <span className="max-w-[80%] text-center leading-tight">
                {src ? 'Change' : 'Add icon'}
              </span>
            </>
          ) : (
            <Camera size={18} />
          )}
        </span>
        {!busy ? (
          <span
            aria-hidden
            className="absolute right-[4%] bottom-[4%] flex items-center justify-center rounded-full bg-brand text-on-brand shadow-sm ring-3 ring-surface"
            style={{ width: Math.max(24, size * 0.26), height: Math.max(24, size * 0.26) }}
          >
            <Camera
              size={Math.round(Math.max(14, size * 0.13))}
              strokeWidth={ICON_STROKE_ON_FILL}
            />
          </span>
        ) : null}
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (!f.type.startsWith('image/') || f.type === 'image/svg+xml') {
            toast.error('Choose a photo (JPEG, PNG or WebP)');
            return;
          }
          setFile(f);
        }}
      />
      <Menu
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        align="start"
        aria-label="Icon options"
        items={[
          { label: 'Upload photo', icon: ImageUp, onSelect: pick },
          onRemove
            ? {
                label: 'Remove photo',
                icon: Trash2,
                danger: true,
                onSelect: () => {
                  void Promise.resolve(onRemove()).catch((e: unknown) => toast.error(e));
                },
              }
            : null,
        ]}
      />
      <AvatarCropModal
        file={file}
        shape={kind === 'community' ? 'square' : 'circle'}
        onCancel={() => setFile(null)}
        onDone={upload}
      />
    </>
  );
}

function ProgressRing({ value, size }: { value: number; size: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} role="progressbar" aria-valuenow={value}>
      <circle cx="20" cy="20" r={r} fill="none" stroke="rgb(255 255 255 / 0.3)" strokeWidth="4" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.05, value))}
        transform="rotate(-90 20 20)"
        className="transition-[stroke-dashoffset] duration-150"
      />
    </svg>
  );
}
