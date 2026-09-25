import { useRef } from 'react';
import { Download, X } from 'lucide-react';
import { IconButton, Portal, useFocusTrap, useOverlay, useScrollLock } from '@/components/ui';
import { mediaUrl } from '@/lib/api';

export interface PhotoViewerProps {
  open: boolean;
  onClose: () => void;
  src: string | null | undefined;
  /** Shown in the top bar and used as alt text. */
  title: string;
  subtitle?: string;
  /** Play a video instead of showing a photo. */
  video?: boolean;
}

/** Full-screen photo lightbox (profile photos). Esc / backdrop / × close it. */
export function PhotoViewer({ open, onClose, src, title, subtitle, video }: PhotoViewerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(open, onClose);
  useScrollLock(open);
  useFocusTrap(ref, open);
  const url = mediaUrl(src);
  if (!open || !url) return null;
  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} photo`}
        tabIndex={-1}
        className="fixed inset-0 z-[70] flex animate-fade-in flex-col bg-black/92 text-white outline-none px-safe"
      >
        <div className="flex h-16 shrink-0 items-center gap-3 px-3 pt-safe">
          <div className="min-w-0 flex-1 pl-2">
            <p className="truncate text-[16px] font-semibold">{title}</p>
            {subtitle ? <p className="truncate text-[13px] text-white/70">{subtitle}</p> : null}
          </div>
          <a
            href={url}
            download
            target="_blank"
            rel="noreferrer"
            aria-label="Open original"
            title="Open original"
            className="flex size-10 items-center justify-center rounded-full text-white/85 hover:bg-white/10"
          >
            <Download size={20} aria-hidden />
          </a>
          <IconButton icon={X} label="Close" variant="glass" onClick={onClose} />
        </div>
        <div
          className="flex min-h-0 flex-1 items-center justify-center p-4 pb-[max(16px,env(safe-area-inset-bottom))]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          {video ? (
            <video
              src={url}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full animate-scale-in rounded-lg shadow-2xl"
            />
          ) : (
            <img
              src={url}
              alt={title}
              className="max-h-full max-w-full animate-scale-in rounded-lg object-contain shadow-2xl"
              draggable={false}
            />
          )}
        </div>
      </div>
    </Portal>
  );
}
