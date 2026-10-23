/**
 * Photos & videos preview before sending (phones): large preview, alt text per item, the
 * caption (the message's text), thumbnails strip (add more / remove), send — they all go as
 * one message, through the composer's tray. Images are re-encoded and videos get a poster on
 * send.
 */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Play, X } from 'lucide-react';
import {
  MAX_ALT_TEXT_LENGTH,
  MAX_CAPTION_LENGTH,
  chatTitle,
  type ChatSummary,
} from '@enbox/shared';
import { SendIcon } from '@/components/icons';
import { IconButton, Portal, useFocusTrap, useOverlay, useScrollLock } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/ui';
import { MAX_ATTACHMENTS, TOO_MANY_ATTACHMENTS } from '../dropzone/files';
import { isVisualMedia } from '../lib/mediaProcessing';

export interface PreviewItem {
  id: string;
  file: File;
  /** Alt text ('' = none). */
  description: string;
}

/** What the preview sends: one message of the items, with the caption. */
export interface PreviewSend {
  caption: string;
  items: { file: File; description: string }[];
}

/**
 * Object URLs for the picked files, created and revoked inside an effect so React's
 * StrictMode double-mount can't leave revoked URLs behind.
 */
function useObjectUrls(entries: { id: string; file: File }[]): Record<string, string> {
  const key = entries.map((e) => e.id).join('|');
  const [urls, setUrls] = useState<Record<string, string>>({});
  const latest = useRef(entries);
  latest.current = entries;
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const e of latest.current) map[e.id] = URL.createObjectURL(e.file);
    setUrls(map);
    return () => {
      for (const u of Object.values(map)) URL.revokeObjectURL(u);
    };
  }, [key]);
  return urls;
}

export function MediaPreviewDialog({
  chat,
  files,
  initialCaption,
  onClose,
  onSend,
}: {
  chat: ChatSummary;
  files: File[];
  initialCaption?: string;
  onClose: () => void;
  onSend: (send: PreviewSend) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const me = useAuth((s) => s.user?.id);
  const [items, setItems] = useState<PreviewItem[]>(() =>
    files.slice(0, MAX_ATTACHMENTS).map((file, i) => ({
      id: `${i}-${file.name}-${file.size}`,
      file,
      description: '',
    })),
  );
  const [caption, setCaption] = useState(initialCaption ?? '');
  const [altOpen, setAltOpen] = useState(false);
  const [current, setCurrent] = useState(0);
  useOverlay(true, onClose);
  useScrollLock(true);
  useFocusTrap(ref, true);

  const urls = useObjectUrls(items);

  const item = items[Math.min(current, items.length - 1)];
  useEffect(() => {
    if (!items.length) onClose();
  }, [items.length, onClose]);
  useEffect(() => {
    if (files.length > MAX_ATTACHMENTS) toast.error(TOO_MANY_ATTACHMENTS, { id: 'attach-limit' });
  }, [files.length]);
  if (!item) return null;

  const add = (list: FileList | null) => {
    const picked = Array.from(list ?? []).filter(isVisualMedia);
    if (!picked.length) return;
    const room = MAX_ATTACHMENTS - items.length;
    if (picked.length > room) toast.error(TOO_MANY_ATTACHMENTS, { id: 'attach-limit' });
    const added = picked.slice(0, Math.max(0, room));
    if (!added.length) return;
    setItems((cur) => [
      ...cur,
      ...added.map((file, i) => ({
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        description: '',
      })),
    ]);
    setCurrent(items.length);
  };

  const remove = (id: string) => {
    const idx = items.findIndex((x) => x.id === id);
    const next = items.filter((x) => x.id !== id);
    setItems(next);
    setCurrent((c) => Math.max(0, Math.min(c > idx ? c - 1 : c, next.length - 1)));
  };

  const describe = (description: string) =>
    setItems((cur) => cur.map((x) => (x.id === item.id ? { ...x, description } : x)));

  const send = () => {
    if (caption.length > MAX_CAPTION_LENGTH) {
      toast.error(`Captions can be up to ${MAX_CAPTION_LENGTH} characters`);
      return;
    }
    onSend({
      caption,
      items: items.map((i) => ({ file: i.file, description: i.description })),
    });
  };

  const video = item.file.type.startsWith('video/');

  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Send photos and videos"
        tabIndex={-1}
        className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-[#0b0b10] text-white outline-none px-safe"
      >
        <header className="flex h-16 shrink-0 items-center gap-2 px-2 pt-safe">
          <IconButton icon={X} label="Cancel" variant="glass" onClick={onClose} />
          <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">
            Send to {chatTitle(chat, me)}
          </h2>
          <span className="pr-2 text-sm text-white/60">
            {current + 1} / {items.length}
          </span>
        </header>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 py-2">
          {video ? (
            <video
              key={item.id}
              src={urls[item.id]}
              controls
              playsInline
              className="max-h-full max-w-full rounded-lg"
            />
          ) : (
            <img
              key={item.id}
              src={urls[item.id]}
              alt={item.description || 'Selected'}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          )}
        </div>

        <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-col gap-3 px-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none">
            {items.map((it, i) => (
              <span key={it.id} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setCurrent(i)}
                  aria-label={`Item ${i + 1}`}
                  aria-current={i === current || undefined}
                  className={cn(
                    'relative block size-14 overflow-hidden rounded-lg bg-white/10',
                    i === current ? 'ring-2 ring-brand' : 'opacity-70 hover:opacity-100',
                  )}
                >
                  {it.file.type.startsWith('video/') ? (
                    <span className="relative block size-full">
                      <video
                        src={urls[it.id]}
                        muted
                        preload="metadata"
                        className="size-full object-cover"
                      />
                      <Play size={16} className="absolute inset-0 m-auto fill-white" aria-hidden />
                    </span>
                  ) : (
                    <img src={urls[it.id]} alt="" className="size-full object-cover" />
                  )}
                  {it.description.trim() ? (
                    <span
                      className="absolute bottom-0.5 left-0.5 rounded-[3px] bg-black/70 px-0.5 text-[9px] leading-3 font-bold"
                      aria-hidden
                    >
                      ALT
                    </span>
                  ) : null}
                </button>
                {items.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove item ${i + 1}`}
                    onClick={() => remove(it.id)}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-black/80 text-white ring-1 ring-white/30"
                  >
                    <X size={12} aria-hidden />
                  </button>
                ) : null}
              </span>
            ))}
            {items.length < MAX_ATTACHMENTS ? (
              <button
                type="button"
                onClick={() => addRef.current?.click()}
                aria-label="Add more"
                className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/30 text-white/70 hover:border-white/60 hover:text-white"
              >
                <ImagePlus size={22} aria-hidden />
              </button>
            ) : null}
            <input
              ref={addRef}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={(e) => {
                add(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          {altOpen ? (
            <textarea
              key={item.id}
              value={item.description}
              onChange={(e) => describe(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  setAltOpen(false);
                }
              }}
              rows={1}
              maxLength={MAX_ALT_TEXT_LENGTH}
              placeholder="Describe it for people who can’t see it"
              aria-label="Description (alt text)"
              className="max-h-24 min-h-10 w-full resize-none rounded-2xl bg-white/10 px-4 py-2 text-[14px] text-white outline-none placeholder:text-white/50 focus:bg-white/15 focus:ring-2 focus:ring-brand/50"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAltOpen(true)}
              className="flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/15"
            >
              <span className="rounded-[4px] bg-white/20 px-1 text-[10px] font-bold tracking-wide">
                ALT
              </span>
              {item.description.trim() ? 'Edit alt text' : 'Add alt text'}
            </button>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Add a caption…"
              aria-label="Caption"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-3xl bg-white/10 px-4 py-2.5 text-[15px] text-white outline-none placeholder:text-white/50 focus:bg-white/15 focus:ring-2 focus:ring-brand/50"
            />
            <IconButton icon={SendIcon} label="Send" variant="brand" size="lg" onClick={send} />
          </div>
        </div>
      </div>
    </Portal>
  );
}
