/**
 * Attachment tray: files waiting in the composer for the next send (paste, drop, "+" picks),
 * up to MAX_ATTACHMENTS — they all go in ONE message (see Composer `sendWithAttachments`).
 * Tiles above the text field show a thumbnail (photos, videos) or an icon, the name and the
 * size (other files), with a toolbar (on hover; always on touch) to mark a photo or video as
 * a spoiler, edit it (rename, alt text) or remove it; drag a tile to reorder (mouse, a long
 * press on touch, or Space and ←/→ on a focused tile).
 *
 * While the message is being sent every tile shows its upload's progress and the tray offers
 * Cancel (back to editing); a failed upload keeps the tray, the failed tiles marked, with
 * Retry (only what is missing goes up again).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CircleAlert,
  CircleCheck,
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
import {
  MAX_ALT_TEXT_LENGTH,
  MAX_FILE_NAME_LENGTH,
  formatBytes,
  type MediaAttachment,
} from '@enbox/shared';
import { Button, Checkbox, IconButton, Input, Modal, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { createObjectUrl, revokeObjectUrl } from '@/lib/media';
import { ProgressRing } from '../bubbles/MediaBody';
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
  /** Photos and videos: alt text ('' = none). */
  description: string;
  /** While sending: the upload's progress (0..1), then the server copy, or a failure. */
  upload?: TrayUpload;
}

export interface TrayUpload {
  progress: number;
  /** Uploaded: a retry or a later send reuses it (a rename or spoiler change drops it). */
  media?: MediaAttachment;
  failed?: boolean;
}

/** `idle`: editing; `sending`: uploading the files of a send; `failed`: some upload failed. */
export type TrayStatus = 'idle' | 'sending' | 'failed';

export type TrayEdit = Partial<Pick<TrayItem, 'name' | 'spoiler' | 'description'>>;

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
    description: '',
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
  status,
  onRemove,
  onToggleSpoiler,
  onEdit,
}: {
  item: TrayItem;
  touch: boolean;
  status: TrayStatus;
  onRemove: () => void;
  onToggleSpoiler: () => void;
  onEdit: () => void;
}) {
  const sending = status === 'sending';
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: sending, data: { label: item.name } });
  const visual = item.kind === 'visual';
  const video = item.file.type.startsWith('video/');
  const url = usePreviewUrl(item.file, visual);
  const Icon = fileIcon(item);
  const hide = item.spoiler && 'scale-110 blur-xl';
  const uploaded = !!item.upload?.media;
  const failed = status === 'failed' && !!item.upload?.failed;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group relative w-[148px] shrink-0 rounded-lg bg-surface-2 p-2 sm:w-[172px]',
        isDragging && 'z-10 shadow-elevated',
        failed && 'ring-1 ring-danger',
      )}
      data-testid="attachment-tile"
      data-spoiler={item.spoiler || undefined}
      data-status={failed ? 'failed' : sending ? (uploaded ? 'uploaded' : 'uploading') : undefined}
    >
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={sending ? item.name : `Move ${item.name}`}
        className={cn(
          'relative flex h-[100px] items-center justify-center overflow-hidden rounded-md bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand sm:h-[116px]',
          !sending && 'cursor-grab touch-manipulation active:cursor-grabbing',
        )}
      >
        {visual ? (
          url ? (
            video ? (
              <video
                src={url}
                muted
                playsInline
                preload="metadata"
                className={cn('pointer-events-none size-full object-cover', hide)}
              />
            ) : (
              <img
                src={url}
                alt={item.description || ''}
                draggable={false}
                className={cn('pointer-events-none size-full object-cover', hide)}
              />
            )
          ) : null
        ) : (
          <Icon size={44} strokeWidth={1.5} className="text-brand-ink" aria-hidden />
        )}
        {video && !item.spoiler && !sending ? (
          <span className="pointer-events-none absolute inset-0 m-auto flex size-9 items-center justify-center rounded-full bg-black/45 text-white">
            <Play size={16} className="ml-0.5 fill-current" aria-hidden />
          </span>
        ) : null}
        {item.spoiler && !sending ? (
          <span className="pointer-events-none absolute inset-0 m-auto h-fit w-fit rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold tracking-wider text-white">
            SPOILER
          </span>
        ) : null}
        {visual && item.description.trim() ? (
          <span
            className="pointer-events-none absolute bottom-1 left-1 rounded-[4px] bg-black/60 px-1 text-[10px] leading-4 font-bold tracking-wide text-white"
            title={item.description}
          >
            ALT
          </span>
        ) : null}
        {sending && !uploaded ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/30">
            <ProgressRing value={item.upload?.progress ?? 0} />
          </span>
        ) : null}
        {uploaded && status !== 'idle' ? (
          <CircleCheck
            size={20}
            className="absolute top-1 right-1 rounded-full bg-black/50 text-white"
            aria-label="Uploaded"
          />
        ) : null}
        {failed ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-danger/25 text-[12px] font-semibold text-white">
            <CircleAlert size={24} className="rounded-full bg-danger" aria-hidden />
            Upload failed
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 truncate text-[13px] font-medium text-fg" title={item.name}>
        {item.name}
      </p>
      {visual ? null : <p className="text-[12px] text-muted">{formatBytes(item.file.size)}</p>}
      {sending ? null : (
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
      )}
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
  onSave: (patch: TrayEdit) => void;
}) {
  const [name, setName] = useState(item.name);
  const [spoiler, setSpoiler] = useState(item.spoiler);
  const [description, setDescription] = useState(item.description);
  const field = useRef<HTMLInputElement>(null);
  const visual = item.kind === 'visual';
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    let next = name.replace(/[\\/]/g, '_').trim();
    // Typing the prefix by hand marks the spoiler instead of becoming part of the name.
    const typedSpoiler = visual && isSpoilerName(next);
    if (typedSpoiler) next = next.slice(SPOILER_PREFIX.length).trim();
    onSave({
      name: next || item.name,
      spoiler: visual && (spoiler || typedSpoiler),
      description: visual ? description.trim() : '',
    });
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
          <Textarea
            label="Description (alt text)"
            value={description}
            maxLength={MAX_ALT_TEXT_LENGTH}
            rows={3}
            placeholder="Describe it for people who can’t see it"
            hint="Screen readers read it out; everyone can show it from the ALT badge."
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              // Enter saves, like the name field; Shift+Enter is a new line.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
        ) : null}
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
  status = 'idle',
  onRemove,
  onChange,
  onReorder,
  onRetry,
  onCancel,
  className,
}: {
  items: TrayItem[];
  touch: boolean;
  status?: TrayStatus;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: TrayEdit) => void;
  /** A tile was dragged from `from` to `to`. */
  onReorder?: (from: number, to: number) => void;
  onRetry?: () => void;
  onCancel?: () => void;
  className?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = status === 'sending' ? undefined : items.find((i) => i.id === editingId);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (!items.length) return null;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from >= 0 && to >= 0) onReorder?.(from, to);
  };
  const nameOf = (id: string | number) => items.find((i) => i.id === id)?.name ?? 'file';
  const uploaded = items.filter((i) => i.upload?.media).length;
  const failed = items.filter((i) => i.upload?.failed).length;

  return (
    <>
      {status !== 'idle' ? (
        <div
          role="status"
          className="flex items-center gap-2 px-2.5 pt-2 text-[13px]"
          data-testid="attachment-tray-status"
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              status === 'failed' ? 'text-danger' : 'text-muted',
            )}
          >
            {status === 'sending'
              ? `Uploading ${Math.min(uploaded + 1, items.length)} of ${items.length}…`
              : `Couldn’t upload ${failed === 1 ? 'a file' : `${failed} files`}`}
          </span>
          {status === 'failed' && onRetry ? (
            <Button size="sm" variant="soft" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
          {status === 'sending' && onCancel ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'To move a file, press Space. Use the left and right arrow keys to move it, Space again to drop it, or Escape to cancel.',
          },
          announcements: {
            onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
            onDragOver: ({ active, over }) =>
              over
                ? `${nameOf(active.id)} is over ${nameOf(over.id)}.`
                : `${nameOf(active.id)} is not over a file.`,
            onDragEnd: ({ active, over }) =>
              over
                ? `${nameOf(active.id)} was dropped at ${nameOf(over.id)}.`
                : `${nameOf(active.id)} was dropped.`,
            onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} was cancelled.`,
          },
        }}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
          {/* Top padding leaves room for the toolbars that sit on the tiles' top edge. */}
          <ul
            aria-label="Attachments"
            className={cn('flex gap-3 overflow-x-auto pt-4 pb-2.5 scrollbar-thin', className)}
            data-testid="attachment-tray"
            data-status={status}
          >
            {items.map((item) => (
              <Tile
                key={item.id}
                item={item}
                touch={touch}
                status={status}
                onRemove={() => onRemove(item.id)}
                onToggleSpoiler={() => onChange(item.id, { spoiler: !item.spoiler })}
                onEdit={() => setEditingId(item.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
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
