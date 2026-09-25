import type { ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui';

export interface PaneHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Back arrow: a path to navigate to, or a callback. */
  back?: string | (() => void);
  /** Icon for `back`: arrow (default) or × (closing side panels). */
  backIcon?: 'arrow' | 'close';
  /** Right-side actions (IconButtons, DropdownMenu). */
  actions?: ReactNode;
  /** Leading content after the back arrow (e.g. an avatar in a conversation header). */
  leading?: ReactNode;
  /** Large tab title (top-level list panes). */
  large?: boolean;
  /** Brand-colored title (the Chats tab "Enbox" title on phones). */
  brandTitle?: boolean;
  /** Rows under the header row (search box, filter chips). */
  children?: ReactNode;
  /** Make the title area clickable (conversation header → info panel). */
  onTitleClick?: () => void;
  className?: string;
  border?: boolean;
}

/**
 * Consistent header for list panes, main panes and full-screen phone pages.
 * Handles the top safe-area inset.
 */
export function PaneHeader({
  title,
  subtitle,
  back,
  backIcon = 'arrow',
  actions,
  leading,
  large,
  brandTitle,
  children,
  onTitleClick,
  className,
  border = false,
}: PaneHeaderProps) {
  const navigate = useNavigate();
  const titleBlock = (
    <div className="min-w-0 flex-1 text-left">
      <h1
        className={cn(
          'truncate font-semibold tracking-tight',
          large ? 'text-[22px] leading-tight' : 'text-[17px] leading-snug',
          brandTitle ? 'text-brand-ink' : 'text-fg',
        )}
      >
        {title}
      </h1>
      {subtitle ? (
        <div className="truncate text-[13px] leading-tight text-muted">{subtitle}</div>
      ) : null}
    </div>
  );
  return (
    <header
      className={cn('shrink-0 bg-surface pt-safe', border && 'border-b border-line', className)}
    >
      <div className={cn('flex items-center gap-1', large ? 'h-16 pr-2 pl-4' : 'h-16 px-2')}>
        {back ? (
          <IconButton
            icon={backIcon === 'close' ? X : ArrowLeft}
            label={backIcon === 'close' ? 'Close' : 'Back'}
            onClick={() => (typeof back === 'string' ? navigate(back) : back())}
            className="shrink-0"
          />
        ) : null}
        {leading}
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            className="flex min-w-0 flex-1 items-center rounded-lg px-1 py-1 outline-none focus-visible:outline-2 focus-visible:outline-brand"
          >
            {titleBlock}
          </button>
        ) : (
          <div className={cn('flex min-w-0 flex-1 items-center', !large && 'px-1')}>
            {titleBlock}
          </div>
        )}
        {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
      </div>
      {children ? <div className="px-3 pb-2">{children}</div> : null}
    </header>
  );
}
