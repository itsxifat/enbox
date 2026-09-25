/**
 * Photos & videos preview before sending: large preview, per-item caption, thumbnails strip
 * (add more / remove), send. Images are re-encoded and videos get a poster on send.
 */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Play, SendHorizontal, X } from 'lucide-react';
import { MAX_CAPTION_LENGTH, chatTitle, type ChatSummary } from '@enbox/shared';
import { IconButton, Portal, useFocusTrap, useOverlay, useScrollLock } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/ui';
import { isVisualMedia } from '../lib/mediaProcessing';

export interface PreviewItem {
  id: string;
  file: File;
  caption: string;
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
  onSend: (items: { file: File; caption: string }[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const me = useAuth((s) => s.user?.id);
  const [items, setItems] = useState<PreviewItem[]>(() =>
    files.map((file, i) => ({
      id: `${i}-${file.name}-${file.size}`,
      file,
      caption: i === 0 ? (initialCaption ?? '') : '',
    })),
  );
  const [current, setCurrent] = useState(0);
  useOverlay(true, onClose);
  useScrollLock(true);
  useFocusTrap(ref, true);

  const urls = useObjectUrls(items);

  const item = items[Math.min(current, items.length - 1)];
  useEffect(() => {
    if (!items.length) onClose();
  }, [items.length, onClose]);
  if (!item) return null;

  const add = (list: FileList | null) => {
    const picked = Array.from(list ?? []).filter(isVisualMedia);
    if (!picked.length) return;
    setItems((cur) => [
      ...cur,
      ...picked.map((file, i) => ({
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        caption: '',
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

  const send = () => {
    if (items.some((i) => i.caption.length > MAX_CAPTION_LENGTH)) {
      toast.error(`Captions can be up to ${MAX_CAPTION_LENGTH} characters`);
      return;
    }
    onSend(items.map((i) => ({ file: i.file, caption: i.caption })));
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
              alt="Selected"
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
                    'block size-14 overflow-hidden rounded-lg bg-white/10',
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
            <button
              type="button"
              onClick={() => addRef.current?.click()}
              aria-label="Add more"
              className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/30 text-white/70 hover:border-white/60 hover:text-white"
            >
              <ImagePlus size={22} aria-hidden />
            </button>
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
          <div className="flex items-end gap-2">
            <textarea
              value={item.caption}
              onChange={(e) =>
                setItems((cur) =>
                  cur.map((x) => (x.id === item.id ? { ...x, caption: e.target.value } : x)),
                )
              }
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
            <IconButton
              icon={SendHorizontal}
              label="Send"
              variant="brand"
              size="lg"
              onClick={send}
            />
          </div>
        </div>
      </div>
    </Portal>
  );
}
