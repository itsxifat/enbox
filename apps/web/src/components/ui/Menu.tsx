import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/lib/cn';
import type { IconType } from './Button';
import { Portal, useOverlay } from './overlay';

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  icon?: IconType;
  danger?: boolean;
  disabled?: boolean;
  /** Right-aligned hint (shortcut, count). */
  hint?: ReactNode;
}

/** A menu entry: an item or a divider. */
export type MenuEntry = MenuItem | 'separator' | null | false | undefined;

export type MenuAnchor = HTMLElement | { x: number; y: number };

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  /** Element to attach to, or a point (context menus: `{ x: e.clientX, y: e.clientY }`). */
  anchor: MenuAnchor | null;
  items: MenuEntry[];
  /** Horizontal alignment relative to an element anchor. */
  align?: 'start' | 'end';
  'aria-label'?: string;
  className?: string;
  /** Called with the element to return focus to after closing (default: the anchor). */
  restoreFocus?: boolean;
}

const MARGIN = 8;

/**
 * Positioned popup menu (portal, fixed). Keyboard: ↑/↓/Home/End move, Enter/Space
 * select, Escape/Tab close. Closes on outside pointer, scroll and resize.
 */
export function Menu({
  open,
  onClose,
  anchor,
  items,
  align = 'start',
  className,
  restoreFocus = true,
  ...aria
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null);
  // Bumped to re-run positioning when the anchor moves right after opening.
  const [layoutTick, setLayoutTick] = useState(0);
  useOverlay(open, onClose);

  const entries = items.filter((e): e is MenuItem | 'separator' => !!e);

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) {
      setPos(null);
      return;
    }
    const menu = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top: number;
    let left: number;
    let fromBottom = false;
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect();
      top = r.bottom + 4;
      left = align === 'end' ? r.right - menu.width : r.left;
      if (top + menu.height > vh - MARGIN && r.top - menu.height - 4 > MARGIN) {
        top = r.top - menu.height - 4;
        fromBottom = true;
      }
    } else {
      top = anchor.y;
      left = anchor.x;
      if (left + menu.width > vw - MARGIN) left = anchor.x - menu.width;
      if (top + menu.height > vh - MARGIN) {
        top = anchor.y - menu.height;
        fromBottom = true;
      }
    }
    left = Math.max(MARGIN, Math.min(left, vw - menu.width - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - menu.height - MARGIN));
    const origin = `${fromBottom ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}`;
    setPos({ top, left, origin });
  }, [open, anchor, align, items.length, layoutTick]);

  // Focus the first item once positioned.
  useLayoutEffect(() => {
    if (!open || !pos) return;
    const first = ref.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not([disabled])',
    );
    first?.focus({ preventScroll: true });
  }, [open, pos]);

  // Outside click / scroll / resize close the menu.
  useLayoutEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor instanceof HTMLElement && anchor.contains(t)) return;
      onClose();
    };
    // Clicking a partly visible row scrolls it into view right after the menu opens; that
    // scroll must reposition the menu, not close it.
    const openedAt = performance.now();
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (performance.now() - openedAt < 300) {
        setLayoutTick((t) => t + 1);
        return;
      }
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      if (restoreFocus && anchor instanceof HTMLElement && document.contains(anchor))
        anchor.focus({ preventScroll: true });
    };
  }, [open, anchor, onClose, restoreFocus]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (n: number) => buttons[(n + buttons.length) % buttons.length]?.focus();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAt(i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAt(i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(-1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
    }
  };

  if (!open || !anchor) return null;
  return (
    <Portal>
      <div
        ref={ref}
        role="menu"
        aria-label={aria['aria-label']}
        onKeyDown={onKeyDown}
        className={cn(
          'fixed z-[60] min-w-48 max-w-[min(20rem,calc(100vw-16px))] rounded-2xl border border-line bg-elevated py-1.5 shadow-elevated',
          pos ? 'animate-scale-in' : 'invisible',
          className,
        )}
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, transformOrigin: pos?.origin }}
      >
        {entries.map((entry, idx) =>
          entry === 'separator' ? (
            <div key={`sep-${idx}`} role="separator" className="my-1.5 h-px bg-line" />
          ) : (
            <button
              key={idx}
              type="button"
              role="menuitem"
              disabled={entry.disabled}
              onClick={() => {
                onClose();
                entry.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] outline-none',
                'hover:bg-hover focus-visible:bg-hover disabled:opacity-45',
                entry.danger ? 'text-danger' : 'text-fg',
              )}
            >
              {entry.icon ? (
                <entry.icon
                  size={18}
                  strokeWidth={1.9}
                  className={entry.danger ? '' : 'text-muted'}
                  aria-hidden
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.hint ? <span className="text-xs text-subtle">{entry.hint}</span> : null}
            </button>
          ),
        )}
      </div>
    </Portal>
  );
}

/** Props handed to a DropdownMenu trigger (spread them on your button). */
export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls'?: string;
  active: boolean;
}

export interface DropdownMenuProps {
  /** Render the trigger with the given props, e.g. `(p) => <IconButton {...p} icon={EllipsisVertical} label="Menu" />`. */
  trigger: (props: MenuTriggerProps) => ReactNode;
  items: MenuEntry[];
  align?: 'start' | 'end';
  'aria-label'?: string;
  className?: string;
}

/** A trigger button + anchored Menu. */
export function DropdownMenu({
  trigger,
  items,
  align = 'end',
  className,
  ...aria
}: DropdownMenuProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      {trigger({
        ref: setAnchor,
        onClick: () => setOpen((o) => !o),
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? id : undefined,
        active: open,
      })}
      <Menu
        open={open}
        onClose={close}
        anchor={anchor}
        items={items}
        align={align}
        className={className}
        aria-label={aria['aria-label']}
      />
    </>
  );
}
