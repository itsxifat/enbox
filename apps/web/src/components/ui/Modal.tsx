import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';
import { Portal, useFocusTrap, useOverlay, useScrollLock } from './overlay';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action row at the bottom (buttons are right-aligned). */
  footer?: ReactNode;
  size?: ModalSize;
  /** Close on backdrop click / Escape (default true). */
  dismissible?: boolean;
  /** Hide the × button in the header. */
  hideClose?: boolean;
  /** Element to focus when opened (default: first focusable). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Bottom-sheet on phones (default true); false keeps a centered card everywhere. */
  sheetOnMobile?: boolean;
  className?: string;
  bodyClassName?: string;
  /** Accessible name when there is no visible title. */
  'aria-label'?: string;
}

/**
 * Accessible dialog: portal, backdrop, Escape (top-most only), focus trap, scroll lock.
 * Phones get a bottom sheet; ≥ sm a centered card. Renders nothing when closed.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  hideClose,
  initialFocus,
  sheetOnMobile = true,
  className,
  bodyClassName,
  ...aria
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useOverlay(open, dismissible ? onClose : undefined);
  useScrollLock(open);
  useFocusTrap(panelRef, open, initialFocus);
  if (!open) return null;

  return (
    <Portal>
      <div
        className={cn(
          'fixed inset-0 z-50 flex justify-center p-0 sm:items-center sm:p-6',
          sheetOnMobile ? 'items-end' : 'items-center p-4',
        )}
      >
        <div
          className="absolute inset-0 animate-fade-in bg-overlay"
          aria-hidden
          onMouseDown={dismissible ? onClose : undefined}
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : aria['aria-label']}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          className={cn(
            'relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-elevated text-fg shadow-elevated outline-none',
            sheetOnMobile
              ? 'animate-slide-up rounded-t-3xl pb-safe sm:animate-scale-in sm:rounded-3xl sm:pb-0'
              : 'max-w-sm animate-scale-in rounded-3xl',
            SIZES[size],
            className,
          )}
        >
          {sheetOnMobile ? (
            <div
              className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden"
              aria-hidden
            />
          ) : null}
          {title || !hideClose ? (
            <div className="flex shrink-0 items-start gap-3 px-6 pt-5 pb-2">
              <div className="min-w-0 flex-1">
                {title ? (
                  <h2 id={titleId} className="text-lg leading-tight font-semibold text-fg">
                    {title}
                  </h2>
                ) : null}
                {description ? (
                  <p id={descId} className="mt-1.5 text-sm text-muted">
                    {description}
                  </p>
                ) : null}
              </div>
              {!hideClose ? (
                <IconButton
                  icon={X}
                  label="Close"
                  size="sm"
                  onClick={onClose}
                  className="-mt-1 -mr-2"
                />
              ) : null}
            </div>
          ) : null}
          <div
            className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-3 scrollbar-thin', bodyClassName)}
          >
            {children}
          </div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-6 pt-2 pb-5">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}
