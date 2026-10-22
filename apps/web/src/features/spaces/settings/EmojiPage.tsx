/**
 * Space Settings → Emoji (MANAGE_EMOJI): upload with the button or by dropping image files
 * anywhere on the page, the upload requirements, "N slots available" of the free
 * SPACE_EMOJI_LIMIT, and a table per kind (Emoji, Animated Emoji) of image, name (click to
 * rename in place), uploader and delete. A new emoji is named after its file (sanitised,
 * made unique); the list stays live through `space:emojis` (stores/emojis.ts).
 */
import { useRef, useState, type DragEvent } from 'react';
import { ImageUp, X } from 'lucide-react';
import {
  MAX_EMOJI_BYTES,
  SPACE_EMOJI_LIMIT,
  formatBytes,
  userDisplayName,
  type Space,
  type SpaceEmoji,
} from '@enbox/shared';
import { CustomEmoji } from '@/components/emoji/CustomEmoji';
import { Avatar, Button, IconButton, Spinner, toast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useEmojis, useSpaceEmojis } from '@/stores/emojis';
import { useUser } from '@/stores/users';
import {
  EMOJI_ACCEPT,
  EMOJI_MAX_DIMENSION,
  emojiNameFromFile,
  isValidEmojiName,
  prepareEmojiImage,
  uniqueEmojiName,
} from './emojiImage';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** What a name input keeps while typing: spaces become `_`, other characters go. */
const typedName = (v: string) => v.replace(/\s/g, '_').replace(/[^A-Za-z0-9_]/g, '').slice(0, 32);

export function EmojiPage({ space }: { space: Space }) {
  const list = useSpaceEmojis(space.id);
  const [pending, setPending] = useState<{ key: number; name: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const nextKey = useRef(0);

  const total = list?.length ?? 0;
  const free = Math.max(0, SPACE_EMOJI_LIMIT - total);

  const upload = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) {
      toast.error('Choose PNG, JPEG, WebP or GIF images.');
      return;
    }
    const current = () => useEmojis.getState().bySpace[space.id] ?? [];
    const taken = new Set(current().map((e) => e.name));
    for (const file of images) {
      if (current().length >= SPACE_EMOJI_LIMIT) {
        toast.error(`All ${SPACE_EMOJI_LIMIT} emoji slots are in use.`);
        break;
      }
      const name = uniqueEmojiName(emojiNameFromFile(file.name), taken);
      taken.add(name);
      const key = nextKey.current++;
      setPending((p) => [...p, { key, name }]);
      try {
        const prepared = await prepareEmojiImage(file);
        const media = await api.upload(
          prepared.file,
          { kind: 'image', width: prepared.width, height: prepared.height },
          undefined,
          { fileName: prepared.fileName, thumbnail: prepared.thumbnail },
        );
        await useEmojis.getState().create(space.id, name, media.id);
      } catch (e) {
        toast.error(`${file.name}: ${errorMessage(e, 'Upload failed')}`);
      } finally {
        setPending((p) => p.filter((x) => x.key !== key));
      }
    }
  };

  const statics = (list ?? []).filter((e) => !e.animated);
  const animated = (list ?? []).filter((e) => e.animated);

  return (
    <div
      className="relative flex flex-col gap-6"
      data-testid="emoji-page"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth.current = 0;
        setDragging(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <section className="flex flex-col gap-3">
        <p className="text-[14px] text-muted">
          Add up to {SPACE_EMOJI_LIMIT} custom emoji that anyone in this Space can use, here and anywhere else on Enbox. Animated
          emoji are free for everyone too.
        </p>
        <div className="card-inset flex flex-col gap-1 p-4 text-[13px] text-muted">
          <h3 className="mb-1 text-[12px] font-bold tracking-wide text-fg uppercase">Upload requirements</h3>
          <p>File type: PNG, JPEG, WebP or GIF</p>
          <p>Max file size: {formatBytes(MAX_EMOJI_BYTES)}</p>
          <p>
            Recommended size: {EMOJI_MAX_DIMENSION}×{EMOJI_MAX_DIMENSION} (stills are resized to it)
          </p>
          <p>Naming: at least 2 characters, only letters, numbers and underscores</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button leftIcon={ImageUp} disabled={free === 0} onClick={() => input.current?.click()}>
            Upload Emoji
          </Button>
          <span className="text-[13px] text-muted" data-testid="emoji-slots">
            {free === 1 ? '1 slot available' : `${free} slots available`}
          </span>
          <span className="text-[13px] text-subtle">or drop images on this page</span>
        </div>
        <input
          ref={input}
          type="file"
          accept={EMOJI_ACCEPT}
          multiple
          hidden
          aria-label="Emoji images"
          data-testid="emoji-file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) void upload(files);
          }}
        />
      </section>

      {pending.length ? (
        <div className="flex items-center gap-2 text-[13px] text-muted" role="status">
          <Spinner size={16} label={null} />
          Uploading {pending.map((p) => `:${p.name}:`).join(', ')}
        </div>
      ) : null}

      {!list ? (
        <Spinner />
      ) : total === 0 && pending.length === 0 ? (
        <p className="card-inset p-6 text-center text-[14px] text-muted">No emoji yet. Upload some, or drop images here.</p>
      ) : (
        <>
          <EmojiTable title="Emoji" emojis={statics} space={space} />
          <EmojiTable title="Animated Emoji" emojis={animated} space={space} />
        </>
      )}

      {dragging ? (
        <div
          className="pointer-events-none absolute -inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-brand/10 text-[15px] font-semibold text-brand-ink"
          aria-hidden
        >
          Drop images to add them as emoji
        </div>
      ) : null}
    </div>
  );
}

function EmojiTable({ title, emojis, space }: { title: string; emojis: SpaceEmoji[]; space: Space }) {
  if (emojis.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-[12px] font-bold tracking-wide text-muted uppercase">
        {title} — {emojis.length}
      </h3>
      <div className="card-inset flex flex-col p-1" role="table" aria-label={title}>
        <div role="row" className="grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-3 px-3 py-1.5 text-[12px] font-semibold text-muted uppercase">
          <span role="columnheader">Image</span>
          <span role="columnheader">Name</span>
          <span role="columnheader">Uploaded by</span>
          <span role="columnheader" className="sr-only">
            Delete
          </span>
        </div>
        {emojis.map((e) => (
          <EmojiRow key={e.id} emoji={e} space={space} />
        ))}
      </div>
    </section>
  );
}

function EmojiRow({ emoji, space }: { emoji: SpaceEmoji; space: Space }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await useEmojis.getState().remove(space.id, emoji.id);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <div
      role="row"
      data-testid={`emoji-row-${emoji.name}`}
      data-animate-avatars
      className={cn('group grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover', busy && 'opacity-50')}
    >
      <span role="cell" className="flex">
        <CustomEmoji id={emoji.id} name={emoji.name} animated={emoji.animated} size={32} />
      </span>
      <span role="cell" className="min-w-0">
        <NameCell emoji={emoji} space={space} />
      </span>
      <span role="cell" className="min-w-0">
        <Uploader userId={emoji.createdBy} />
      </span>
      <span role="cell" className="flex justify-end">
        <IconButton
          icon={X}
          label={`Delete :${emoji.name}:`}
          variant="ghost"
          disabled={busy}
          className="text-danger opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          onClick={() => void remove()}
        />
      </span>
    </div>
  );
}

/** The name, an input while renaming (Enter or leaving saves, Escape cancels). */
function NameCell({ emoji, space }: { emoji: SpaceEmoji; space: Space }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(emoji.name);
  const done = useRef(false);

  const start = () => {
    done.current = false;
    setValue(emoji.name);
    setEditing(true);
  };
  const commit = async () => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = value.trim();
    if (next === emoji.name) return;
    if (!isValidEmojiName(next)) {
      toast.error('Emoji names need 2-32 letters, numbers or underscores.');
      return;
    }
    try {
      await useEmojis.getState().rename(space.id, emoji.id, next);
    } catch (e) {
      toast.error(e);
    }
  };

  if (!editing)
    return (
      <button
        type="button"
        onClick={start}
        title="Click to rename"
        className="max-w-full truncate rounded-md px-2 py-1 text-left text-[15px] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"
      >
        {emoji.name}
      </button>
    );
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(typedName(e.target.value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          done.current = true;
          setEditing(false);
        }
      }}
      onBlur={() => void commit()}
      aria-label={`Rename :${emoji.name}:`}
      maxLength={32}
      className="h-9 w-full rounded-md bg-surface-2 px-2 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-brand"
    />
  );
}

function Uploader({ userId }: { userId: string | null }) {
  const user = useUser(userId);
  if (!userId) return <span className="text-[14px] text-subtle">Unknown</span>;
  const name = userDisplayName(user);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar src={user?.avatarUrl} name={name} colorSeed={userId} size={24} decorative />
      <span className="truncate text-[14px]">{name}</span>
    </span>
  );
}
