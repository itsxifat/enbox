import { useId, useRef, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { IconButton } from './Button';
import { Portal, useFocusTrap, useOverlay, useScrollLock } from './overlay';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Header title. Omit to render your own header inside `children`. */
  title?: ReactNode;
  /** Extra buttons on the right of the header. */
  actions?: ReactNode;
  children: ReactNode;
  side?: 'right' | 'left';
  /** Desktop panel width in px (default 420). Phones are always full screen. */
  width?: number;
  /** Dim the page behind on desktop (default true). */
  backdrop?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * Side panel (chat/contact/group info, media galleries). Desktop: slides in from the
 * right over the main pane; phones: full screen with a back arrow.
 */
export function Sheet({
  open,
  onClose,
  title,
  actions,
  children,
  side = 'right',
  width = 420,
  backdrop = true,
  className,
  ...aria
}: SheetProps) {
  const desktop = useIsDesktop();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlay(open, onClose);
  useScrollLock(open && !desktop);
  useFocusTrap(ref, open);
  if (!open) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-40 flex"
        style={{ justifyContent: side === 'right' ? 'flex-end' : 'flex-start' }}
      >
        {backdrop ? (
          <div
            className="absolute inset-0 hidden animate-fade-in bg-overlay/60 lg:block"
            aria-hidden
            onMouseDown={onClose}
          />
        ) : null}
        <aside
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : aria['aria-label']}
          tabIndex={-1}
          className={cn(
            'relative flex h-full w-full flex-col bg-surface text-fg shadow-elevated outline-none',
            'animate-slide-in-right lg:border-l lg:border-line',
            className,
          )}
          style={desktop ? { width, maxWidth: '100vw' } : undefined}
        >
          {title ? (
            <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 pt-safe lg:px-3">
              <IconButton icon={desktop ? X : ArrowLeft} label="Close" onClick={onClose} />
              <h2 id={titleId} className="min-w-0 flex-1 truncate text-[17px] font-semibold">
                {title}
              </h2>
              {actions}
            </header>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto pb-safe scrollbar-thin">{children}</div>
        </aside>
      </div>
    </Portal>
  );
}
