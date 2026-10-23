/**
 * Upload or edit a sticker (Space Settings ▸ Stickers). Uploading: a file — PNG, APNG, WebP
 * or GIF up to MAX_STICKER_BYTES, prepared by stickerUpload.ts and previewed at sticker size
 * — then its name (2-30 characters, prefilled from the file name), a related emoji (typed or
 * picked; suggestions follow it) and a description. Editing changes the last three. Errors
 * stay in the dialog (toasts) so nothing typed is lost.
 */
import { Suspense, useEffect, useRef, useState, type DragEvent } from 'react';
import { ImageUp, Smile } from 'lucide-react';
import {
  MAX_STICKER_BYTES,
  STICKER_NAME_MAX_LENGTH,
  formatBytes,
  type Space,
  type SpaceSticker,
} from '@enbox/shared';
import {
  Button,
  IconButton,
  Input,
  Modal,
  Popover,
  Spinner,
  Textarea,
  toast,
} from '@/components/ui';
import { LazyEmojiPicker } from '@/features/conversation/lazy';
import { useIsTouch } from '@/hooks/useMediaQuery';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { createObjectUrl, revokeObjectUrl } from '@/lib/media';
import { useStickers } from '@/stores/stickers';
import {
  STICKER_ACCEPT,
  prepareStickerImage,
  stickerNameFromFile,
  type PreparedSticker,
} from './stickerUpload';
import { StickerImage, useStickerPlayback } from './StickerImage';

const DESCRIPTION_MAX = 100;
const EMOJI_MAX = 80;

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

interface Chosen {
  prepared: PreparedSticker;
  url: string;
  posterUrl: string | null;
}

export function StickerDialog({
  space,
  sticker,
  initialFile,
  onClose,
}: {
  space: Space;
  /** The sticker to edit; null uploads a new one. */
  sticker: SpaceSticker | null;
  /** A file to upload, chosen already (dropped on the page). */
  initialFile?: File;
  onClose: () => void;
}) {
  const editing = !!sticker;
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [name, setName] = useState(sticker?.name ?? '');
  const [emoji, setEmoji] = useState(sticker?.emoji ?? '');
  const [description, setDescription] = useState(sticker?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const touch = useIsTouch();
  const input = useRef<HTMLInputElement>(null);
  const chosenRef = useRef<Chosen | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const release = (c: Chosen | null) => {
    revokeObjectUrl(c?.url);
    revokeObjectUrl(c?.posterUrl);
  };
  useEffect(() => () => release(chosenRef.current), []);
  const keep = (c: Chosen | null) => {
    release(chosenRef.current);
    chosenRef.current = c;
    setChosen(c);
  };

  const choose = async (file: File) => {
    setFileError(null);
    setFileName(file.name);
    setPreparing(true);
    setName((n) => (n.trim() ? n : stickerNameFromFile(file.name)));
    try {
      const prepared = await prepareStickerImage(file);
      keep({
        prepared,
        url: createObjectUrl(prepared.file),
        posterUrl: prepared.thumbnail ? createObjectUrl(prepared.thumbnail) : null,
      });
    } catch (e) {
      keep(null);
      setFileError(errorMessage(e, "This file can't be used as a sticker."));
    } finally {
      setPreparing(false);
    }
  };

  const first = useRef(initialFile);
  useEffect(() => {
    if (first.current && !sticker) void choose(first.current);
    first.current = undefined;
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmed = name.trim();
  const nameOk = trimmed.length >= 2 && trimmed.length <= STICKER_NAME_MAX_LENGTH;
  const ready = editing || (!!chosen && !preparing);
  const canSave = nameOk && ready && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const fields = {
      name: trimmed,
      emoji: emoji.trim() || null,
      description: description.trim() || null,
    };
    try {
      if (sticker) {
        await useStickers.getState().update(space.id, sticker.id, fields);
      } else {
        const p = chosen!.prepared;
        const media = await api.upload(
          p.file,
          { kind: 'image', width: p.width, height: p.height },
          setProgress,
          { fileName: p.fileName, thumbnail: p.thumbnail },
        );
        await useStickers.getState().create(space.id, { ...fields, mediaId: media.id });
      }
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
      setProgress(null);
    }
  };

  const previewUrl = chosen?.url ?? sticker?.url ?? null;
  const animated = chosen ? chosen.prepared.animated : !!sticker?.animated;
  const playing = useStickerPlayback(previewRef, animated, 'open', 'sticker');

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit Sticker' : 'Upload Sticker'}
      description={
        editing
          ? undefined
          : 'Stickers can be still or animated. Everyone in this Space can use them.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!canSave} onClick={() => void save()}>
            {editing
              ? 'Save'
              : progress !== null && progress < 1
                ? `Uploading ${Math.round(progress * 100)}%`
                : 'Upload'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <div
            ref={previewRef}
            data-testid="sticker-preview"
            onDragOver={(e) => {
              if (!editing && hasFiles(e)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={(e) => {
              if (editing || !hasFiles(e)) return;
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) void choose(file);
            }}
            className={cn(
              'flex size-[176px] shrink-0 items-center justify-center rounded-2xl bg-surface-2',
              !editing && !previewUrl && 'border-2 border-dashed border-line-strong',
            )}
          >
            {preparing ? (
              <Spinner />
            ) : previewUrl ? (
              <StickerImage
                url={previewUrl}
                stillUrl={chosen ? chosen.posterUrl : null}
                animated={animated}
                playing={playing}
                alt={trimmed ? `Preview of ${trimmed}` : 'Sticker preview'}
                size={160}
              />
            ) : (
              <ImageUp size={32} className="text-subtle" aria-hidden />
            )}
          </div>
          {!editing ? (
            <div className="flex min-w-0 flex-1 flex-col gap-2 text-[13px] text-muted">
              <p className="font-semibold text-fg">File</p>
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => input.current?.click()}
                  disabled={busy}
                >
                  Browse
                </Button>
                <span className="min-w-0 truncate" data-testid="sticker-file-name">
                  {fileName ?? 'No file chosen'}
                </span>
              </div>
              {fileError ? (
                <p role="alert" className="text-danger">
                  {fileError}
                </p>
              ) : (
                <p>
                  PNG, APNG, WebP or GIF, up to {formatBytes(MAX_STICKER_BYTES)}. 320×320 works
                  best.
                </p>
              )}
              <input
                ref={input}
                type="file"
                accept={STICKER_ACCEPT}
                hidden
                aria-label="Sticker file"
                data-testid="sticker-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void choose(file);
                }}
              />
            </div>
          ) : null}
        </div>

        <Input
          label="Sticker name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, STICKER_NAME_MAX_LENGTH))}
          maxLength={STICKER_NAME_MAX_LENGTH}
          aside={`${trimmed.length}/${STICKER_NAME_MAX_LENGTH}`}
          error={name && !nameOk ? 'Use at least 2 characters' : undefined}
          placeholder="Name your sticker"
          required
        />
        <Input
          label="Related emoji"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value.slice(0, EMOJI_MAX))}
          maxLength={EMOJI_MAX}
          hint="People who type this emoji get the sticker as a suggestion."
          placeholder={touch ? 'Type an emoji' : 'Pick or type an emoji'}
          rightSlot={
            // Phones have an emoji keyboard (and a popover would close as it opens).
            touch ? undefined : (
              <IconButton
                icon={Smile}
                label="Choose an emoji"
                size="sm"
                active={!!emojiAnchor}
                onClick={(e) => setEmojiAnchor(emojiAnchor ? null : e.currentTarget)}
              />
            )
          }
        />
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
          maxLength={DESCRIPTION_MAX}
          rows={2}
          aside={`${description.length}/${DESCRIPTION_MAX}`}
          placeholder="What is this sticker about? (screen readers read it too)"
        />
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>

      <Popover
        open={!!emojiAnchor}
        anchor={emojiAnchor}
        onClose={() => setEmojiAnchor(null)}
        placement="bottom"
        align="end"
        aria-label="Choose a related emoji"
        className="overflow-hidden"
      >
        <div className="w-[min(340px,calc(100vw-16px))]">
          <Suspense
            fallback={
              <div className="flex h-[360px] items-center justify-center text-brand-ink">
                <Spinner />
              </div>
            }
          >
            {emojiAnchor ? (
              <LazyEmojiPicker
                height={360}
                autoFocusSearch
                onPick={(picked) => {
                  setEmoji(picked);
                  setEmojiAnchor(null);
                }}
              />
            ) : null}
          </Suspense>
        </div>
      </Popover>
    </Modal>
  );
}
