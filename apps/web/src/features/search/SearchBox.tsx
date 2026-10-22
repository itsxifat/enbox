/**
 * The header search box (Discord): about 144px wide, 240px while focused or filled, filters as
 * chips before the words, and a dropdown of suggestions for the word at the caret (see
 * suggestions.ts). Enter opens the results beside the conversation
 * (`useSidePanel().open({ kind: 'search', scope, query })`); Esc clears; Ctrl/Cmd+F focuses it.
 * Its content is kept per scope (stores/search.ts), so moving between the channels of a Space
 * keeps the search.
 *
 * Keys: ↑/↓ move through the suggestions, Enter or Tab picks one (a person, a value, a date),
 * Enter without a pick runs the search, Backspace at the start removes the last chip.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AtSign,
  CalendarDays,
  ChartColumn,
  Code,
  Film,
  Hash,
  History,
  ImageIcon,
  Link,
  Paperclip,
  Pin,
  Plus,
  Search,
  User,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { UserAvatar } from '@/components/common/UserAvatar';
import { cn } from '@/lib/cn';
import { scopeKey, useSearch } from '@/stores/search';
import { useSidePanel, type SearchScope } from '@/stores/sidePanel';
import { useChannelCandidates, usePersonCandidates, useTokenLabel } from './candidates';
import {
  EMPTY_QUERY,
  activeWord,
  addToken,
  isEmptyQuery,
  parseQuery,
  replaceWord,
  serializeQuery,
  type FilterKey,
  type ParsedQuery,
  type SearchToken,
} from './query';
import { KEY_HINTS, buildSuggestions, type SuggestionItem, type SuggestionSection } from './suggestions';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const HAS_ICONS: Record<string, LucideIcon> = {
  link: Link,
  embed: Code,
  file: Paperclip,
  video: Film,
  image: ImageIcon,
  sound: Volume2,
  poll: ChartColumn,
};

const KEY_ICONS: Record<FilterKey, LucideIcon> = {
  from: User,
  mentions: AtSign,
  has: Paperclip,
  before: CalendarDays,
  during: CalendarDays,
  after: CalendarDays,
  in: Hash,
  pinned: Pin,
};

export interface SearchBoxProps {
  scope: SearchScope;
  placeholder?: string;
  /** Phones: fill the row instead of 144 → 240px. */
  fullWidth?: boolean;
  autoFocus?: boolean;
  /** Listen for Ctrl/Cmd+F (desktop header). */
  shortcut?: boolean;
  /** After Enter opened the results. */
  onSubmitted?: () => void;
}

/** One chip: `from: Alice ×`. */
function TokenChip({ scope, token, onRemove }: { scope: SearchScope; token: SearchToken; onRemove: () => void }) {
  const label = useTokenLabel(scope, token);
  return (
    <span
      data-testid="search-chip"
      className="inline-flex h-5 max-w-[140px] shrink-0 items-center gap-0.5 rounded-[4px] bg-brand-soft pr-0.5 pl-1 text-[12px] leading-5 text-brand-ink"
    >
      <span className="font-semibold">{token.key}:</span>
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${token.key}: ${label}`}
        // Keep the caret in the input.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="ml-0.5 rounded-sm text-brand-ink/70 hover:text-brand-ink"
      >
        <X size={12} aria-hidden />
      </button>
    </span>
  );
}

/** A recent search as it reads: `from: Alice has: link quokka`. */
function RecentQuery({ scope, query }: { scope: SearchScope; query: string }) {
  const q = parseQuery(query);
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      {q.tokens.map((t, i) => (
        <RecentToken key={i} scope={scope} token={t} />
      ))}
      {q.text ? <span className="truncate text-fg">{q.text}</span> : null}
    </span>
  );
}

function RecentToken({ scope, token }: { scope: SearchScope; token: SearchToken }) {
  const label = useTokenLabel(scope, token);
  return (
    <span className="shrink-0">
      <span className="font-semibold text-fg">{token.key}:</span> <span className="text-muted">{label}</span>
    </span>
  );
}

function ItemContent({ item, onPickDate }: { item: SuggestionItem; onPickDate: (key: FilterKey, value: string) => void }) {
  switch (item.type) {
    case 'key': {
      const Icon = KEY_ICONS[item.key];
      return (
        <>
          <Icon size={16} className="shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold text-fg">{item.key}:</span>{' '}
            <span className="text-muted">{KEY_HINTS[item.key]}</span>
          </span>
          <Plus size={16} className="shrink-0 text-muted opacity-0 group-hover/item:opacity-100 group-aria-selected/item:opacity-100" aria-hidden />
        </>
      );
    }
    case 'token': {
      const { key, value } = item.token;
      const lead =
        key === 'from' || key === 'mentions' ? (
          <UserAvatar userId={value} size={20} decorated={false} />
        ) : (
          (() => {
            const Icon = key === 'has' ? (HAS_ICONS[value] ?? Paperclip) : KEY_ICONS[key];
            return <Icon size={16} className="shrink-0 text-muted" aria-hidden />;
          })()
        );
      return (
        <>
          {lead}
          <span className="min-w-0 flex-1 truncate text-fg">{item.label}</span>
          {item.detail ? <span className="shrink-0 truncate text-[12px] text-muted">{item.detail}</span> : null}
        </>
      );
    }
    case 'recent':
      return null; // rendered by the caller (needs the scope)
    case 'date-picker':
      return (
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <CalendarDays size={16} className="shrink-0 text-muted" aria-hidden />
          <span className="shrink-0 text-muted">Pick a date</span>
          <input
            type="date"
            data-date-picker
            aria-label={`${item.key}: pick a date`}
            className="min-w-0 flex-1 rounded bg-surface-2 px-1.5 py-0.5 text-[13px] text-fg outline-none focus:ring-2 focus:ring-brand/40"
            onChange={(e) => {
              if (e.target.value) onPickDate(item.key, e.target.value);
            }}
          />
        </label>
      );
  }
}

export function SearchBox({ scope, placeholder = 'Search', fullWidth, autoFocus, shortcut, onSubmitted }: SearchBoxProps) {
  const key = scopeKey(scope);
  const draft = useSearch((s) => s.drafts[key]) ?? EMPTY_QUERY;
  const recents = useSearch((s) => s.recents[key]);
  const { tokens, text } = draft;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(text.length);
  const [nav, setNav] = useState<{ sig: string; index: number } | null>(null);
  const listId = useId();

  const word = activeWord(text, caret);
  const asksPeople = open && (word.key === 'from' || word.key === 'mentions');
  const people = usePersonCandidates(scope, asksPeople ? word.partial : null);
  const channels = useChannelCandidates(scope, open && word.key === 'in' ? word.partial : null);
  const empty = isEmptyQuery(draft);
  const sections: SuggestionSection[] = open
    ? buildSuggestions({ scopeKind: scope.kind, word, empty, people, channels, recents: recents ?? [] })
    : [];
  const items = sections.flatMap((s) => s.items);
  const sig = `${word.key ?? ''}:${word.partial}:${items.map((i) => i.id).join(',')}`;
  const pickable = (i: SuggestionItem | undefined) => !!i && i.type !== 'recent' && i.type !== 'key';
  // A filter being typed suggests its first value (Enter / Tab pick it, as in Discord).
  const index = nav?.sig === sig ? nav.index : word.key && pickable(items[0]) ? 0 : -1;
  const highlighted = index >= 0 ? items[index] : undefined;

  const setDraft = (next: ParsedQuery, nextCaret?: number) => {
    useSearch.getState().setDraft(key, next);
    if (nextCaret !== undefined) pendingCaret.current = nextCaret;
  };

  // Put the caret where a pick left it once the controlled value rendered.
  useLayoutEffect(() => {
    const c = pendingCaret.current;
    const input = inputRef.current;
    if (c === null || !input) return;
    pendingCaret.current = null;
    input.setSelectionRange(c, c);
    setCaret(c);
  }, [draft]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Ctrl/Cmd+F focuses the box while the conversation is open (it is mounted only then).
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'f' || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);

  // Keep the highlighted suggestion in view.
  useEffect(() => {
    if (!highlighted) return;
    listRef.current?.querySelector(`[data-item-id="${highlighted.id}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted]);

  function submit(q: ParsedQuery = draft) {
    // Typed filters (`has:image`, `before:2026-10-01`) become chips too.
    const parsed = parseQuery(serializeQuery(q));
    if (isEmptyQuery(parsed)) return;
    const query = serializeQuery(parsed);
    setDraft(parsed, parsed.text.length);
    useSearch.getState().remember(key, query);
    useSidePanel.getState().open({ kind: 'search', scope, query });
    setOpen(false);
    onSubmitted?.();
  }

  function clear() {
    setDraft(EMPTY_QUERY, 0);
    const panel = useSidePanel.getState().panel;
    if (panel?.kind === 'search' && scopeKey(panel.scope) === key) useSidePanel.getState().close();
  }

  function addChip(token: SearchToken) {
    const r = replaceWord(text, word, '');
    setDraft({ tokens: addToken(tokens, token), text: r.text }, r.caret);
    setNav(null);
    inputRef.current?.focus();
  }

  function pick(item: SuggestionItem) {
    switch (item.type) {
      case 'key': {
        const r = replaceWord(text, word, `${item.key}:`);
        setDraft({ tokens, text: r.text }, r.caret);
        setNav(null);
        inputRef.current?.focus();
        return;
      }
      case 'token':
        addChip(item.token);
        return;
      case 'recent': {
        const q = parseQuery(item.query);
        submit(q);
        return;
      }
      case 'date-picker': {
        const input = listRef.current?.querySelector<HTMLInputElement>('input[data-date-picker]');
        input?.focus();
        try {
          input?.showPicker?.();
        } catch {
          /* not allowed without a user gesture in some browsers */
        }
      }
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        if (!items.length) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = index + step < -1 ? items.length - 1 : index + step >= items.length ? -1 : index + step;
        setNav({ sig, index: next });
        return;
      }
      case 'Enter':
        e.preventDefault();
        if (open && highlighted) pick(highlighted);
        else submit();
        return;
      case 'Tab':
        if (open && highlighted && word.key) {
          e.preventDefault();
          pick(highlighted);
        }
        return;
      case 'Escape':
        setOpen(false);
        if (isEmptyQuery(draft)) {
          // Nothing to clear: leave the box, and let the Escape reach the page (sheets, selection).
          inputRef.current?.blur();
          return;
        }
        // Clearing is ours: the conversation's Escape (selection, in-chat search) must not fire too.
        e.preventDefault();
        e.stopPropagation();
        clear();
        return;
      case 'Backspace': {
        const input = e.currentTarget;
        if (input.selectionStart === 0 && input.selectionEnd === 0 && tokens.length) {
          e.preventDefault();
          setDraft({ tokens: tokens.slice(0, -1), text }, 0);
        }
        return;
      }
    }
  };

  const hasContent = !isEmptyQuery(draft);
  const wide = fullWidth || focused || hasContent;
  const activeId = highlighted ? `${listId}-${highlighted.id}` : undefined;

  let row: ReactNode = null;
  if (open && sections.length) {
    row = (
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Search options"
        data-testid="search-suggestions"
        className={cn(
          'absolute top-full right-0 z-50 mt-2 max-h-[min(460px,70vh)] overflow-y-auto rounded-lg bg-elevated p-2 text-[14px] shadow-elevated scrollbar-thin animate-fade-in',
          fullWidth ? 'left-0' : 'w-[320px]',
        )}
        // Clicks keep the caret in the input (the date picker takes focus itself).
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
        }}
      >
        {sections.map((section) => (
          <div key={section.id} role="group" aria-label={section.title} className="pb-1">
            <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
              <span className="section-label">{section.title}</span>
              {section.clearable ? (
                <button
                  type="button"
                  className="text-[12px] text-muted hover:text-fg hover:underline"
                  onClick={() => useSearch.getState().clearRecents(key)}
                >
                  Clear
                </button>
              ) : null}
            </div>
            {section.items.map((item) => {
              const selected = item === highlighted;
              return (
                <div
                  key={item.id}
                  id={`${listId}-${item.id}`}
                  data-item-id={item.id}
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    'group/item flex h-8 cursor-pointer items-center gap-2 rounded-md px-2',
                    selected ? 'bg-hover text-fg' : 'hover:bg-hover',
                  )}
                  onClick={(e) => {
                    if (item.type === 'date-picker' && (e.target as HTMLElement).closest('input')) return;
                    pick(item);
                  }}
                  onMouseMove={() => {
                    if (!selected) setNav({ sig, index: items.indexOf(item) });
                  }}
                >
                  {item.type === 'recent' ? (
                    <>
                      <History size={16} className="shrink-0 text-muted" aria-hidden />
                      <RecentQuery scope={scope} query={item.query} />
                    </>
                  ) : (
                    <ItemContent item={item} onPickDate={(k, value) => addChip({ key: k, value })} />
                  )}
                </div>
              );
            })}
            {section.items.length === 0 ? (
              <p className="px-2 py-1.5 text-[13px] text-muted">No matches</p>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative shrink-0 transition-[width] duration-200 ease-out',
        fullWidth ? 'w-full' : wide ? 'w-[240px]' : 'w-[144px]',
      )}
      data-testid="header-search"
      onFocus={() => {
        setFocused(true);
        setOpen(true);
      }}
      onBlur={(e) => {
        if (rootRef.current?.contains(e.relatedTarget as Node | null)) return;
        setFocused(false);
        setOpen(false);
      }}
    >
      <div
        className={cn(
          'flex items-center gap-1 rounded-md bg-surface-2 pr-1 pl-1.5 text-[14px] ring-brand/40 transition-shadow focus-within:ring-2',
          fullWidth ? 'h-10' : 'h-7',
        )}
        onMouseDown={(e) => {
          // Clicking the box (not a chip button) focuses the text.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
          {tokens.map((t, i) => (
            <TokenChip
              key={`${t.key}:${t.value}`}
              scope={scope}
              token={t}
              onRemove={() => setDraft({ tokens: tokens.filter((_, j) => j !== i), text })}
            />
          ))}
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search messages"
            aria-autocomplete="list"
            aria-expanded={open && sections.length > 0}
            aria-controls={open && sections.length ? listId : undefined}
            aria-activedescendant={activeId}
            autoComplete="off"
            spellCheck={false}
            value={text}
            placeholder={tokens.length ? '' : placeholder}
            onChange={(e) => {
              setDraft({ tokens, text: e.target.value });
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setOpen(true);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className="h-full min-w-[3rem] flex-1 bg-transparent text-fg outline-none placeholder:text-subtle"
          />
        </div>
        {hasContent ? (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              clear();
              inputRef.current?.focus();
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:text-fg"
          >
            <X size={16} aria-hidden />
          </button>
        ) : (
          <Search size={16} className="mr-0.5 shrink-0 text-muted" aria-hidden />
        )}
      </div>
      {row}
    </div>
  );
}
