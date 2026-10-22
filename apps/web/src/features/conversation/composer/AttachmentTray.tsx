/**
 * Attachment tray: files waiting in the composer for the next send (paste, drop, "+" picks).
 * Tiles above the text field show a thumbnail (photos, videos) or an icon, the name and the
 * size (other files), with a toolbar (on hover; always on touch) to mark a photo or video as
 * a spoiler, edit it (rename) or remove it. The composer sends them (see Composer `send`).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Eye,
  EyeOff,
  FileArchive,
  FileMusic,
  FileSpreadsheet,
  FileText,
  Pencil,
  Play,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { MAX_FILE_NAME_LENGTH, formatBytes } from '@enbox/shared';
import { Button, Checkbox, IconButton, Input, Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import { createObjectUrl, revokeObjectUrl } from '@/lib/media';
import { SPOILER_PREFIX, isSpoilerName } from '../dropzone/files';
import { isVisualMedia } from '../lib/mediaProcessing';

export interface TrayItem {
  id: string;
  /** The picked file (its name is replaced by `name` on upload, see `trayFile`). */
  file: File;
  /** Shown and uploaded name, without the spoiler prefix. */
  name: string;
  /** Photos and videos only: blurred for everyone until clicked. */
  spoiler: boolean;
  /** Photos/videos are re-encoded and get a thumbnail; audio gets a player; the rest a card. */
  kind: 'visual' | 'audio' | 'file';
}

let nextId = 0;

export function trayItem(file: File): TrayItem {
  const visual = isVisualMedia(file);
  // A re-shared spoiler keeps its mark (the prefix is the mark, not part of the name).
  const spoiler = visual && isSpoilerName(file.name);
  return {
    id: `attachment-${++nextId}`,
    file,
    name: (spoiler ? file.name.slice(SPOILER_PREFIX.length) : file.name) || 'file',
    spoiler,
    kind: visual ? 'visual' : file.type.startsWith('audio/') ? 'audio' : 'file',
  };
}

/** The file to upload: renamed and marked (`SPOILER_` prefix) without copying its bytes. */
export function trayFile(item: TrayItem): File {
  const name = (item.spoiler ? SPOILER_PREFIX : '') + item.name;
  if (name === item.file.name) return item.file;
  return new File([item.file], name, {
    type: item.file.type,
    lastModified: item.file.lastModified,
  });
}

function fileIcon(item: TrayItem): LucideIcon {
  if (item.kind === 'audio') return FileMusic;
  if (/\.(zip|rar|7z|tar|gz|tgz)$/i.test(item.name)) return FileArchive;
  if (/\.(xlsx?|csv|ods|numbers)$/i.test(item.name)) return FileSpreadsheet;
  return FileText;
}

/** An object URL for the tile's preview, revoked when the tile goes away. */
function usePreviewUrl(file: File, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const u = createObjectUrl(file);
    setUrl(u);
    return () => revokeObjectUrl(u);
  }, [file, enabled]);
  return url;
}

function Tile({
  item,
  touch,
  onRemove,
  onToggleSpoiler,
  onEdit,
}: {
  item: TrayItem;
  touch: boolean;
  onRemove: () => void;
  onToggleSpoiler: () => void;
  onEdit: () => void;
}) {
  const visual = item.kind === 'visual';
  const video = item.file.type.startsWith('video/');
  const url = usePreviewUrl(item.file, visual);
  const Icon = fileIcon(item);
  const hide = item.spoiler && 'scale-110 blur-xl';
  return (
    <li
      className="group relative w-[148px] shrink-0 rounded-lg bg-surface-2 p-2 sm:w-[172px]"
      data-testid="attachment-tile"
      data-spoiler={item.spoiler || undefined}
    >
      <div className="relative flex h-[100px] items-center justify-center overflow-hidden rounded-md bg-surface sm:h-[116px]">
        {visual ? (
          url ? (
            video ? (
              <video
                src={url}
                muted
                playsInline
                preload="metadata"
                className={cn('size-full object-cover', hide)}
              />
            ) : (
              <img
                src={url}
                alt=""
                draggable={false}
                className={cn('size-full object-cover', hide)}
              />
            )
          ) : null
        ) : (
          <Icon size={44} strokeWidth={1.5} className="text-brand-ink" aria-hidden />
        )}
        {video && !item.spoiler ? (
          <span className="pointer-events-none absolute inset-0 m-auto flex size-9 items-center justify-center rounded-full bg-black/45 text-white">
            <Play size={16} className="ml-0.5 fill-current" aria-hidden />
          </span>
        ) : null}
        {item.spoiler ? (
          <span className="pointer-events-none absolute inset-0 m-auto h-fit w-fit rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold tracking-wider text-white">
            SPOILER
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 truncate text-[13px] font-medium text-fg" title={item.name}>
        {item.name}
      </p>
      {visual ? null : <p className="text-[12px] text-muted">{formatBytes(item.file.size)}</p>}
      <div
        role="toolbar"
        aria-label={`${item.name} options`}
        className={cn(
          'absolute -top-3 right-1.5 flex items-center rounded-md bg-elevated p-0.5 shadow-elevated ring-1 ring-line transition-opacity duration-150',
          touch
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      >
        {visual ? (
          <IconButton
            icon={item.spoiler ? EyeOff : Eye}
            label={
              item.spoiler ? `Remove spoiler from ${item.name}` : `Mark ${item.name} as spoiler`
            }
            aria-pressed={item.spoiler}
            size="xs"
            shape="square"
            active={item.spoiler}
            onClick={onToggleSpoiler}
          />
        ) : null}
        <IconButton
          icon={Pencil}
          label={`Edit ${item.name}`}
          size="xs"
          shape="square"
          onClick={onEdit}
        />
        <IconButton
          icon={Trash2}
          label={`Remove ${item.name}`}
          size="xs"
          shape="square"
          className="text-danger!"
          onClick={onRemove}
        />
      </div>
    </li>
  );
}

function EditDialog({
  item,
  onClose,
  onSave,
}: {
  item: TrayItem;
  onClose: () => void;
  onSave: (patch: Pick<TrayItem, 'name' | 'spoiler'>) => void;
}) {
  const [name, setName] = useState(item.name);
  const [spoiler, setSpoiler] = useState(item.spoiler);
  const field = useRef<HTMLInputElement>(null);
  const visual = item.kind === 'visual';
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    let next = name.replace(/[\\/]/g, '_').trim();
    // Typing the prefix by hand marks the spoiler instead of becoming part of the name.
    const typedSpoiler = visual && isSpoilerName(next);
    if (typedSpoiler) next = next.slice(SPOILER_PREFIX.length).trim();
    onSave({ name: next || item.name, spoiler: visual && (spoiler || typedSpoiler) });
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit attachment"
      size="sm"
      initialFocus={field}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit()}>Save</Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          ref={field}
          label="File name"
          value={name}
          maxLength={MAX_FILE_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => {
            // Select the name without its extension, like a file manager's rename.
            const dot = e.currentTarget.value.lastIndexOf('.');
            e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length);
          }}
        />
        {visual ? (
          <Checkbox
            checked={spoiler}
            onChange={setSpoiler}
            label="Mark as spoiler"
            description="It stays blurred until someone clicks it."
          />
        ) : null}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

export function AttachmentTray({
  items,
  touch,
  onRemove,
  onChange,
  className,
}: {
  items: TrayItem[];
  touch: boolean;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<Pick<TrayItem, 'name' | 'spoiler'>>) => void;
  className?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = items.find((i) => i.id === editingId);
  if (!items.length) return null;
  return (
    <>
      {/* Top padding leaves room for the toolbars that sit on the tiles' top edge. */}
      <ul
        aria-label="Attachments"
        className={cn('flex gap-3 overflow-x-auto pt-4 pb-2.5 scrollbar-thin', className)}
        data-testid="attachment-tray"
      >
        {items.map((item) => (
          <Tile
            key={item.id}
            item={item}
            touch={touch}
            onRemove={() => onRemove(item.id)}
            onToggleSpoiler={() => onChange(item.id, { spoiler: !item.spoiler })}
            onEdit={() => setEditingId(item.id)}
          />
        ))}
      </ul>
      {editing ? (
        <EditDialog
          key={editing.id}
          item={editing}
          onClose={() => setEditingId(null)}
          onSave={(patch) => {
            onChange(editing.id, patch);
            setEditingId(null);
          }}
        />
      ) : null}
    </>
  );
}
