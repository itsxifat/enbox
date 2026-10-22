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
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { IconType } from './Button';
import { Portal, isInOverlayAbove, useOverlay } from './overlay';

export interface MenuItem {
  label: ReactNode;
  /** Not needed for an item that only opens its `submenu`. */
  onSelect?: () => void;
  icon?: IconType;
  danger?: boolean;
  disabled?: boolean;
  /** Right-aligned hint (shortcut, count). */
  hint?: ReactNode;
  /** Second line under the label (e.g. "Muted until 3:45 PM"). */
  description?: ReactNode;
  /** Opens a nested menu (→ / Enter / hover); ← or Escape goes back. */
  submenu?: MenuEntry[];
  /** A checkbox item (`menuitemcheckbox`) when set; a radio item with `radio`. */
  checked?: boolean;
  /** With `checked`: one of a group of choices (`menuitemradio`). */
  radio?: boolean;
  /** Stay open after selecting (checkbox toggles). */
  keepOpen?: boolean;
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
  /** Where an element-anchored menu opens: below it (default) or beside it (submenus). */
  side?: 'bottom' | 'right';
  'aria-label'?: string;
  className?: string;
  /** Called with the element to return focus to after closing (default: the anchor). */
  restoreFocus?: boolean;
  /** DOM id of the menu (referenced by the trigger's `aria-controls`). */
  id?: string;
  /** After an item was chosen (default: `onClose`); submenus close their whole chain. */
  onItemSelected?: () => void;
  /** Focus the first item when opened (default true; hover-opened submenus keep focus). */
  autoFocus?: boolean;
  /** A submenu: ← closes it. */
  nested?: boolean;
}

const MARGIN = 8;
const ITEM_SELECTOR = '[role^="menuitem"]:not([disabled])';

/** Context menus opened from the keyboard (Shift+F10 / the Menu key) have no pointer position. */
export function contextMenuAnchor(e: {
  clientX: number;
  clientY: number;
  currentTarget: EventTarget;
}): MenuAnchor {
  return e.clientX === 0 && e.clientY === 0 && e.currentTarget instanceof HTMLElement
    ? e.currentTarget
    : { x: e.clientX, y: e.clientY };
}

/**
 * Positioned popup menu (portal, fixed). Keyboard: ↑/↓/Home/End move, Enter/Space
 * select, → opens a submenu and ← leaves it, Escape/Tab close. Closes on outside pointer,
 * scroll and resize. Items can be checkboxes or radios (`checked`) and open submenus.
 */
export function Menu({
  open,
  onClose,
  anchor,
  items,
  align = 'start',
  side = 'bottom',
  className,
  restoreFocus = true,
  id,
  onItemSelected,
  autoFocus = true,
  nested = false,
  ...aria
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null);
  // Bumped to re-run positioning when the anchor moves right after opening.
  const [layoutTick, setLayoutTick] = useState(0);
  const [sub, setSub] = useState<{ index: number; el: HTMLElement; focus: boolean } | null>(null);
  const overlayId = useOverlay(open, onClose, ref);
  const baseId = useId();

  const entries = items.filter((e): e is MenuItem | 'separator' => !!e);
  const done = onItemSelected ?? onClose;
  const closeSub = useCallback(() => setSub(null), []);
  const closeAll = useCallback(() => {
    setSub(null);
    done();
  }, [done]);

  useLayoutEffect(() => {
    if (!open) setSub(null);
  }, [open]);

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
    if (anchor instanceof HTMLElement && side === 'right') {
      const r = anchor.getBoundingClientRect();
      // Beside the item, first row level with it; flips left when there is no room.
      left = r.right + 2;
      if (left + menu.width > vw - MARGIN) left = r.left - menu.width - 2;
      top = r.top - 6;
      if (top + menu.height > vh - MARGIN) top = r.bottom - menu.height + 6;
    } else if (anchor instanceof HTMLElement) {
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
  }, [open, anchor, align, side, items.length, layoutTick]);

  // Focus the first item once positioned.
  useLayoutEffect(() => {
    if (!open || !pos || !autoFocus) return;
    const first = ref.current?.querySelector<HTMLButtonElement>(ITEM_SELECTOR);
    first?.focus({ preventScroll: true });
  }, [open, pos, autoFocus]);

  // Outside click / scroll / resize close the menu.
  useLayoutEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor instanceof HTMLElement && anchor.contains(t)) return;
      if (isInOverlayAbove(overlayId, t)) return;
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
  }, [open, anchor, onClose, restoreFocus, overlayId]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Keys pressed inside an open submenu bubble here through React's tree: not ours.
    if (!ref.current?.contains(e.target as Node)) return;
    const buttons = Array.from(ref.current.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR));
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
    } else if (e.key === 'ArrowRight') {
      const el = document.activeElement as HTMLElement | null;
      const index = Number(el?.dataset.subIndex ?? NaN);
      if (el && !Number.isNaN(index)) {
        e.preventDefault();
        setSub({ index, el, focus: true });
      }
    } else if (e.key === 'ArrowLeft' && nested) {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
    }
  };

  if (!open || !anchor) return null;
  const subEntry = sub ? entries[sub.index] : undefined;
  const subItems = subEntry && subEntry !== 'separator' ? subEntry.submenu : undefined;
  return (
    <Portal>
      <div
        ref={ref}
        id={id}
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
        {entries.map((entry, idx) => {
          if (entry === 'separator')
            return <div key={`sep-${idx}`} role="separator" className="my-1.5 h-px bg-line" />;
          const hasSub = !!entry.submenu?.some(Boolean);
          const checkable = entry.checked !== undefined;
          const labelId = `${baseId}-l${idx}`;
          const descId = `${baseId}-d${idx}`;
          return (
            <button
              key={idx}
              type="button"
              role={checkable ? (entry.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem'}
              aria-checked={checkable ? entry.checked : undefined}
              aria-haspopup={hasSub ? 'menu' : undefined}
              aria-expanded={hasSub ? sub?.index === idx : undefined}
              aria-labelledby={entry.description ? labelId : undefined}
              aria-describedby={entry.description ? descId : undefined}
              data-sub-index={hasSub ? idx : undefined}
              disabled={entry.disabled}
              onPointerEnter={(e) => {
                if (e.pointerType === 'touch' || sub?.index === idx) return;
                if (hasSub) setSub({ index: idx, el: e.currentTarget, focus: false });
                else if (sub) setSub(null);
              }}
              onClick={(e) => {
                if (hasSub) {
                  setSub(
                    sub?.index === idx ? null : { index: idx, el: e.currentTarget, focus: true },
                  );
                  return;
                }
                if (!entry.keepOpen) closeAll();
                entry.onSelect?.();
              }}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] outline-none',
                'hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:opacity-45',
                entry.danger ? 'text-danger' : 'text-fg',
                sub?.index === idx && 'bg-hover',
              )}
            >
              {entry.icon ? (
                <entry.icon size={20} className={entry.danger ? '' : 'text-muted'} aria-hidden />
              ) : null}
              <span className="min-w-0 flex-1">
                <span id={labelId} className="block truncate">
                  {entry.label}
                </span>
                {entry.description ? (
                  <span id={descId} className="block truncate text-[12px] text-muted">
                    {entry.description}
                  </span>
                ) : null}
              </span>
              {entry.hint ? <span className="text-xs text-subtle">{entry.hint}</span> : null}
              {checkable ? <CheckMark checked={!!entry.checked} radio={!!entry.radio} /> : null}
              {hasSub ? <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      {subItems && sub ? (
        <Menu
          open
          nested
          side="right"
          anchor={sub.el}
          items={subItems}
          onClose={closeSub}
          onItemSelected={closeAll}
          autoFocus={sub.focus}
          restoreFocus={sub.focus}
          aria-label={
            subEntry && subEntry !== 'separator' && typeof subEntry.label === 'string'
              ? subEntry.label
              : undefined
          }
        />
      ) : null}
    </Portal>
  );
}

function CheckMark({ checked, radio }: { checked: boolean; radio: boolean }) {
  if (radio)
    return (
      <span
        aria-hidden
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border-2',
          checked ? 'border-brand' : 'border-line-strong',
        )}
      >
        {checked ? <span className="size-2.5 rounded-full bg-brand" /> : null}
      </span>
    );
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-md border-2',
        checked ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
      )}
    >
      {checked ? <Check size={14} strokeWidth={3} /> : null}
    </span>
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
        id={id}
        aria-label={aria['aria-label']}
      />
    </>
  );
}
