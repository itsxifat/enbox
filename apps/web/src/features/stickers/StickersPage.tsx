/**
 * Space Settings ▸ Stickers (MANAGE_EMOJI): the intro and upload requirements, "Upload
 * Sticker" (StickerDialog: file with a preview, name, related emoji, description) with "N of
 * SPACE_STICKER_LIMIT slots available", and a grid of sticker cards — hovering one (or
 * focusing into it) shows Edit and Delete, and plays it when animated. An image file dropped
 * on the page opens the upload dialog with it. The list stays live through `space:stickers`
 * (stores/stickers.ts).
 */
import { useRef, useState, type DragEvent } from 'react';
import { ImageUp, Pencil, Trash2 } from 'lucide-react';
import {
  MAX_STICKER_BYTES,
  SPACE_STICKER_LIMIT,
  STICKER_NAME_MAX_LENGTH,
  formatBytes,
  userDisplayName,
  type Space,
  type SpaceSticker,
} from '@enbox/shared';
import { Avatar, Button, IconButton, Spinner, confirm, toast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useSpaceStickers, useStickers } from '@/stores/stickers';
import { useUser } from '@/stores/users';
import { StickerDialog } from './StickerDialog';
import { StickerImage, useStickerPlayback } from './StickerImage';
import { STICKER_MAX_DIMENSION } from './stickerUpload';

type DialogState = { sticker: SpaceSticker | null; file?: File } | null;

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export function StickersPage({ space }: { space: Space }) {
  const list = useSpaceStickers(space.id);
  const [dialog, setDialog] = useState<DialogState>(null);
  const total = list?.length ?? 0;
  const free = Math.max(0, SPACE_STICKER_LIMIT - total);
  const canUpload = !!list && free > 0 && !dialog;

  return (
    <div
      className="flex flex-col gap-6"
      data-testid="stickers-page"
      onDragOver={(e) => {
        if (!canUpload || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        if (!canUpload || !hasFiles(e)) return;
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) setDialog({ sticker: null, file });
      }}
    >
      <section className="flex flex-col gap-3">
        <p className="text-[14px] text-muted">
          Stickers are custom pictures, still or animated, that anyone in this Space can send — in
          its channels and in any other chat on Enbox. Every Space gets {SPACE_STICKER_LIMIT} free
          sticker slots.
        </p>
        <div className="card-inset flex flex-col gap-1 p-4 text-[13px] text-muted">
          <h3 className="mb-1 text-[12px] font-bold tracking-wide text-fg uppercase">
            Upload requirements
          </h3>
          <p>File type: PNG, APNG, WebP or GIF</p>
          <p>Max file size: {formatBytes(MAX_STICKER_BYTES)}</p>
          <p>
            Recommended size: {STICKER_MAX_DIMENSION}×{STICKER_MAX_DIMENSION} (larger stills are
            resized to it)
          </p>
          <p>Name: 2 to {STICKER_NAME_MAX_LENGTH} characters</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            leftIcon={ImageUp}
            disabled={!list || free === 0}
            onClick={() => setDialog({ sticker: null })}
          >
            Upload Sticker
          </Button>
          <span className="text-[13px] text-muted" data-testid="sticker-slots">
            {free} of {SPACE_STICKER_LIMIT} slots available
          </span>
        </div>
      </section>

      {!list ? (
        <Spinner />
      ) : total === 0 ? (
        <p className="card-inset p-6 text-center text-[14px] text-muted">
          No stickers yet. Upload the first one.
        </p>
      ) : (
        <section className="flex flex-col gap-2" aria-label="Stickers">
          <h3 className="text-[12px] font-bold tracking-wide text-muted uppercase">
            Stickers — {total}
          </h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-3">
            {list.map((s) => (
              <StickerCard
                key={s.id}
                sticker={s}
                space={space}
                onEdit={() => setDialog({ sticker: s })}
              />
            ))}
          </ul>
        </section>
      )}

      {dialog ? (
        <StickerDialog
          key={dialog.sticker?.id ?? 'new'}
          space={space}
          sticker={dialog.sticker}
          initialFile={dialog.file}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function StickerCard({
  sticker,
  space,
  onEdit,
}: {
  sticker: SpaceSticker;
  space: Space;
  onEdit: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const playing = useStickerPlayback(ref, sticker.animated, 'self', 'sticker');
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete Sticker',
      message: `“${sticker.name}” will be removed from this Space. Messages that already show it keep the picture.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await useStickers.getState().remove(space.id, sticker.id);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <li
      ref={ref}
      data-testid={`sticker-card-${sticker.name}`}
      className={cn(
        'card-inset group relative flex min-w-0 flex-col items-center gap-2 px-3 pt-4 pb-3',
        busy && 'opacity-50',
      )}
    >
      <StickerImage
        url={sticker.url}
        animated={sticker.animated}
        playing={playing}
        alt={sticker.name}
        size={112}
      />
      <div className="w-full min-w-0 text-center">
        <p className="truncate text-[14px] font-semibold" title={sticker.name}>
          {sticker.emoji ? <span className="mr-1">{sticker.emoji}</span> : null}
          {sticker.name}
        </p>
        {sticker.description ? (
          <p className="truncate text-[12px] text-muted" title={sticker.description}>
            {sticker.description}
          </p>
        ) : null}
        <Uploader userId={sticker.createdBy} />
      </div>
      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <IconButton
          icon={Pencil}
          label={`Edit ${sticker.name}`}
          size="xs"
          variant="solid"
          disabled={busy}
          onClick={onEdit}
        />
        <IconButton
          icon={Trash2}
          label={`Delete ${sticker.name}`}
          size="xs"
          variant="solid"
          disabled={busy}
          className="text-danger"
          onClick={() => void remove()}
        />
      </div>
    </li>
  );
}

function Uploader({ userId }: { userId: string | null }) {
  const user = useUser(userId);
  if (!userId) return null;
  const name = userDisplayName(user);
  return (
    <span className="mt-1 flex min-w-0 items-center justify-center gap-1.5 text-[12px] text-muted">
      <Avatar src={user?.avatarUrl} name={name} colorSeed={userId} size={16} decorative />
      <span className="truncate">{name}</span>
    </span>
  );
}
