/**
 * The formatting toolbar over selected text in the message box (desktop; touch has none):
 * Bold, Italic, Underline, Strikethrough, Spoiler, Code, Quote and Link — the address typed
 * in a small field in the toolbar itself. It floats above the selection's first line
 * (./caret.ts), never takes focus from the box on click, and is reached with Alt+F10:
 * ←/→/Home/End move between its buttons, Escape or Tab go back to the box.
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from 'react';
import {
  Bold,
  Check,
  Code,
  EyeOff,
  Italic,
  Link,
  Strikethrough,
  TextQuote,
  Underline,
} from 'lucide-react';
import { Portal, placePopover, type IconType } from '@/components/ui';
import { cn } from '@/lib/cn';
import { selectionAnchorRect } from './caret';
import { canLink, isQuoted, isWrapped, normalizeLinkUrl, type InlineFormat } from './markdown';
import { MOD_KEY } from './shortcuts';

export type ToolbarFormat = InlineFormat | 'quote';

const BUTTONS: { format: ToolbarFormat; label: string; icon: IconType; keys?: string }[] = [
  { format: 'bold', label: 'Bold', icon: Bold, keys: `${MOD_KEY}+B` },
  { format: 'italic', label: 'Italic', icon: Italic, keys: `${MOD_KEY}+I` },
  { format: 'underline', label: 'Underline', icon: Underline, keys: `${MOD_KEY}+U` },
  { format: 'strike', label: 'Strikethrough', icon: Strikethrough, keys: `${MOD_KEY}+Shift+X` },
  { format: 'spoiler', label: 'Spoiler', icon: EyeOff },
  { format: 'code', label: 'Code', icon: Code },
  { format: 'quote', label: 'Quote', icon: TextQuote },
];

function ToolbarButton({
  icon: Icon,
  label,
  title,
  pressed,
  disabled,
  onClick,
}: {
  icon: IconType;
  label: string;
  title?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
        pressed && 'bg-hover text-brand-ink',
      )}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}

/** ←/→/Home/End between the toolbar's buttons. */
function moveFocus(e: KeyboardEvent<HTMLDivElement>): boolean {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return false;
  const buttons = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
  );
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return false;
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? buttons.length - 1
        : i + (e.key === 'ArrowRight' ? 1 : -1);
  buttons[(next + buttons.length) % buttons.length]?.focus();
  return true;
}

export function FormattingToolbar({
  field,
  value,
  start,
  end,
  onFormat,
  onLink,
  onLeave,
  onBlurAway,
  ref,
}: {
  field: RefObject<HTMLTextAreaElement | null>;
  /** The field's text. */
  value: string;
  start: number;
  end: number;
  onFormat: (format: ToolbarFormat) => void;
  /** A checked web address for the selection. */
  onLink: (url: string) => void;
  /** Back to the box, the selection kept: Escape (`close`: the toolbar goes) or Tab. */
  onLeave: (close: boolean) => void;
  /** Focus went somewhere else than the box. */
  onBlurAway: () => void;
  ref?: Ref<HTMLDivElement>;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  // Stable: the link field focuses itself while committing, and the box asks this ref then
  // whether focus stayed in the toolbar (an inline ref would be detached at that moment).
  const setBox = useCallback(
    (el: HTMLDivElement | null) => {
      box.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);

  // Float above the selection: again when it moves, the field scrolls or the window resizes.
  useLayoutEffect(() => {
    const ta = field.current;
    if (!ta) return;
    const place = () => {
      const el = box.current;
      if (!el) return;
      const anchor = selectionAnchorRect(ta, start, end);
      const { top, left } = placePopover(
        anchor,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        'top',
        'center',
      );
      setPos((p) => (p?.top === top && p.left === left ? p : { top, left }));
    };
    place();
    ta.addEventListener('scroll', place);
    window.addEventListener('resize', place);
    return () => {
      ta.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [field, value, start, end, linking]);

  const linkable = canLink(value, start, end);

  const submitLink = () => {
    const href = normalizeLinkUrl(url);
    if (!href) {
      setInvalid(true);
      linkInput.current?.focus();
      return;
    }
    onLink(href);
  };

  const closeLink = () => {
    // The focused field goes away: hold the focus in the toolbar meanwhile.
    box.current?.focus({ preventScroll: true });
    setLinking(false);
    setUrl('');
    setInvalid(false);
    requestAnimationFrame(() =>
      box.current?.querySelector<HTMLButtonElement>('button[aria-label="Link"]')?.focus(),
    );
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    if (to && (e.currentTarget.contains(to) || to === field.current)) return;
    onBlurAway();
  };

  return (
    <Portal>
      <div
        ref={setBox}
        role="toolbar"
        aria-label="Formatting"
        aria-keyshortcuts="Alt+F10"
        tabIndex={-1}
        data-testid="formatting-toolbar"
        // Clicks keep the focus (and the selection) in the box; the link field takes it.
        onMouseDown={(e) => {
          if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (linking) closeLink();
            else onLeave(true);
            return;
          }
          if (e.key === 'Tab' && !linking) {
            e.preventDefault();
            onLeave(false);
            return;
          }
          if (!linking && moveFocus(e)) e.preventDefault();
        }}
        onBlur={onBlur}
        style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
        className="fixed z-[60] flex items-center gap-0.5 rounded-lg bg-elevated p-0.5 shadow-elevated outline-none animate-fade-in"
      >
        {linking ? (
          <form
            className="flex items-center gap-0.5"
            onSubmit={(e) => {
              e.preventDefault();
              submitLink();
            }}
          >
            <Link size={16} className="mx-1.5 shrink-0 text-muted" aria-hidden />
            <input
              ref={linkInput}
              value={url}
              autoFocus
              onChange={(e) => {
                setUrl(e.target.value);
                setInvalid(false);
              }}
              placeholder="Paste a link"
              aria-label="Link address"
              aria-invalid={invalid || undefined}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                'h-8 w-56 min-w-0 rounded-md bg-surface-2 px-2 text-[14px] text-fg outline-none placeholder:text-subtle',
                invalid ? 'ring-2 ring-danger/60' : 'focus:ring-2 focus:ring-brand/40',
              )}
            />
            <button
              type="submit"
              aria-label="Add link"
              title="Add link"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            >
              <Check size={18} aria-hidden />
            </button>
          </form>
        ) : (
          <>
            {BUTTONS.map((b) => (
              <ToolbarButton
                key={b.format}
                icon={b.icon}
                label={b.label}
                title={b.keys ? `${b.label} (${b.keys})` : b.label}
                pressed={
                  b.format === 'quote'
                    ? isQuoted(value, start, end)
                    : isWrapped(value, start, end, b.format)
                }
                onClick={() => onFormat(b.format)}
              />
            ))}
            <ToolbarButton
              icon={Link}
              label="Link"
              title={linkable ? 'Link' : 'Select one line of text to make it a link'}
              disabled={!linkable}
              onClick={() => setLinking(true)}
            />
          </>
        )}
      </div>
    </Portal>
  );
}
