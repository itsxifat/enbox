/**
 * Drop files anywhere: while a conversation with a composer is open, dragging files from the
 * OS over any part of the window covers the conversation with an "Upload to #channel" card.
 * A drop adds the files to the composer's attachment tray; a Shift-drop uploads them right
 * away (bus `composer:files`). Without ATTACH_FILES (Space channels) the card turns red and
 * the drop is refused.
 *
 * Only drags that carry files count: text, links and drags that start inside the page are
 * ignored. A depth counter over dragenter/dragleave keeps the card from flickering as the
 * pointer crosses elements; drop, dragend and Escape hide it, and a watchdog hides it when
 * dragover stops arriving (a dragleave the browser never sent).
 */
import { useEffect, useRef, useState } from 'react';
import { Ban, FileImage, FileText, FileUp } from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { bus } from '@/lib/bus';
import { cn } from '@/lib/cn';
import { NO_UPLOAD_PERMISSION, canAttachFiles, dragHasFiles, uploadTargetLabel } from './files';

/** Browsers repeat dragover every few hundred ms while a drag is over the page. */
const WATCHDOG_MS = 1500;

function modalOpen(): boolean {
  return !!document.querySelector('[aria-modal="true"]');
}

export function ConversationDropzone({ chat }: { chat: ChatSummary }) {
  const [active, setActive] = useState(false);
  const allowed = canAttachFiles(chat);
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const chatId = chat.id;

  useEffect(() => {
    let depth = 0;
    /** This drag is not for us: it started in the page, over a dialog, or Escape dismissed it. */
    let ignored = false;
    let internal = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const stopWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
    };
    const reset = () => {
      depth = 0;
      ignored = false;
      stopWatchdog();
      setActive(false);
    };
    const ours = (e: DragEvent) => !internal && dragHasFiles(e);

    const onStart = () => {
      internal = true;
    };
    const onEnd = () => {
      internal = false;
      reset();
    };
    // No dragend reaches the window when the dragged element was removed meanwhile: the
    // next press ends that drag for us (none can happen while a drag is running).
    const onPress = () => {
      internal = false;
    };
    const onEnter = (e: DragEvent) => {
      if (!ours(e)) return;
      e.preventDefault();
      if (depth === 0) ignored = modalOpen();
      depth += 1;
      if (!ignored) setActive(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!ours(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) reset();
    };
    const onOver = (e: DragEvent) => {
      if (!ours(e) || e.defaultPrevented) return;
      // Claim every file drag: a file dropped where nothing takes it would replace the app.
      e.preventDefault();
      if (e.dataTransfer)
        e.dataTransfer.dropEffect = !ignored && allowedRef.current ? 'copy' : 'none';
      if (ignored) return;
      setActive(true);
      stopWatchdog();
      watchdog = setTimeout(reset, WATCHDOG_MS);
    };
    const onDrop = (e: DragEvent) => {
      if (!ours(e)) return;
      const skip = ignored;
      reset();
      // Taken by a drop target inside the page (a dialog's own upload field).
      if (e.defaultPrevented) return;
      e.preventDefault();
      if (skip || !allowedRef.current) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) bus.emit('composer:files', { chatId, files, direct: e.shiftKey });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || depth === 0 || ignored) return;
      e.preventDefault();
      e.stopPropagation();
      ignored = true;
      stopWatchdog();
      setActive(false);
    };

    window.addEventListener('dragstart', onStart);
    window.addEventListener('dragend', onEnd);
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('keydown', onKey, true);
    return () => {
      stopWatchdog();
      window.removeEventListener('dragstart', onStart);
      window.removeEventListener('dragend', onEnd);
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [chatId]);

  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-40 flex animate-fade-in items-center justify-center bg-overlay px-4 pt-16 pb-6"
      data-testid="drop-overlay"
      data-denied={allowed ? undefined : 'true'}
      role="status"
    >
      <div
        className={cn(
          'relative w-full max-w-[380px] animate-scale-in rounded-[20px] p-2 shadow-elevated',
          allowed ? 'bg-brand text-on-brand' : 'bg-danger text-white',
        )}
      >
        <div className="absolute -top-11 left-1/2 flex -translate-x-1/2 items-end" aria-hidden>
          {allowed ? (
            <>
              <span className="flex size-16 translate-x-3 translate-y-1 -rotate-12 items-center justify-center rounded-xl bg-white text-brand shadow-elevated">
                <FileImage size={30} />
              </span>
              <span className="z-10 flex size-20 items-center justify-center rounded-2xl bg-white text-brand shadow-elevated">
                <FileUp size={40} />
              </span>
              <span className="flex size-16 -translate-x-3 translate-y-1 rotate-12 items-center justify-center rounded-xl bg-white text-brand shadow-elevated">
                <FileText size={30} />
              </span>
            </>
          ) : (
            <span className="flex size-20 items-center justify-center rounded-full bg-white text-danger shadow-elevated">
              <Ban size={40} />
            </span>
          )}
        </div>
        <div className="flex flex-col items-center rounded-[14px] border-2 border-dashed border-current/40 px-6 pt-14 pb-6 text-center">
          <h2 className="text-[20px] leading-tight font-bold">
            {allowed ? `Upload to ${uploadTargetLabel(chat)}` : NO_UPLOAD_PERMISSION}
          </h2>
          {allowed ? (
            <p className="mt-2 text-[14px] leading-snug opacity-85">
              You can add comments before uploading. Hold Shift to upload directly.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
