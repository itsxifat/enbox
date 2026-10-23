/**
 * The sticker picker (the composer's popover; import it through `LazyStickerPicker`): a search
 * box (name, related emoji, description), one section per Space with its icon in a left rail
 * — the chat's own Space first, other Spaces only where USE_EXTERNAL_EMOJI allows
 * (groups.ts) — and a 4-column grid per section. Animated stickers play on hover (the
 * device pref decides, StickerImage.tsx). A click, or Enter on a search with results, sends
 * the sticker (`onPick`); arrow keys move between stickers, Down from the search box enters
 * the grid. My groups load on first open (stores/stickers.ts).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Sticker as StickerIcon } from 'lucide-react';
import type { SpaceSticker, SpaceStickerGroup } from '@enbox/shared';
import { SearchInput, Spinner } from '@/components/ui';
import { SpaceIcon } from '@/features/spaces/community/SpaceIcon';
import { cn } from '@/lib/cn';
import { useStickerGroups } from '@/stores/stickers';
import { searchStickerGroups, stickerPickerGroups, type StickerChat } from './groups';
import { StickerImage, useStickerPlayback } from './StickerImage';

export interface StickerPickerProps {
  /** The chat it sends to (a Space channel narrows and orders the groups). */
  chat: StickerChat;
  onPick: (sticker: SpaceSticker) => void;
  /** Focus the search box on open (default; touch devices skip it: no keyboard popping up). */
  autoFocusSearch?: boolean;
  /** Size classes (default: the popover's). */
  className?: string;
}

const COLUMNS = 4;

export function StickerPicker({
  chat,
  onPick,
  autoFocusSearch = true,
  className = 'h-[min(440px,60dvh)] w-[min(424px,calc(100vw-16px))]',
}: StickerPickerProps) {
  const all = useStickerGroups(true);
  const groups = useMemo(() => stickerPickerGroups(all, chat), [all, chat]);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => searchStickerGroups(groups, query), [groups, query]);
  const [active, setActive] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocusSearch) search.current?.focus({ preventScroll: true });
    // On open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cells = () =>
    Array.from(scroller.current?.querySelectorAll<HTMLButtonElement>('[data-sticker-cell]') ?? []);

  const jumpTo = (spaceId: string) => {
    setActive(spaceId);
    const el = scroller.current?.querySelector<HTMLElement>(`[data-space-section="${spaceId}"]`);
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop;
  };

  /** The rail follows the section at the top of the list. */
  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    let current: string | null = null;
    for (const el of box.querySelectorAll<HTMLElement>('[data-space-section]')) {
      if (el.offsetTop - box.scrollTop > 8) break;
      current = el.dataset.spaceSection ?? null;
    }
    setActive(current ?? shown[0]?.spaceId ?? null);
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowDown'
            ? COLUMNS
            : e.key === 'ArrowUp'
              ? -COLUMNS
              : 0;
    if (!step) return;
    const list = cells();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = at + step;
    if (next < 0) search.current?.focus();
    else list[Math.min(next, list.length - 1)]?.focus();
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      const first = cells()[0];
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      const first = shown[0]?.stickers[0];
      if (first) {
        e.preventDefault();
        onPick(first);
      }
    }
  };

  const current = active ?? shown[0]?.spaceId ?? null;

  return (
    <div className={cn('flex flex-col', className)} data-testid="sticker-picker">
      <div className="shrink-0 p-2 pb-1">
        <SearchInput
          ref={search}
          value={query}
          onChange={(v) => {
            setQuery(v);
            setActive(null);
            if (scroller.current) scroller.current.scrollTop = 0;
          }}
          onKeyDown={onSearchKey}
          placeholder="Find the perfect sticker"
          aria-label="Search stickers"
        />
      </div>
      {all === null ? (
        <div className="flex flex-1 items-center justify-center text-brand-ink">
          <Spinner />
        </div>
      ) : groups.length === 0 ? (
        <EmptyNote
          title="No stickers yet"
          text={
            chat.space
              ? 'Stickers of this Space show up here once someone adds them in Space Settings.'
              : 'Stickers of your Spaces show up here once someone adds them in Space Settings.'
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Spaces"
            className="flex w-12 shrink-0 flex-col items-center gap-1.5 overflow-y-auto py-1 scrollbar-thin"
          >
            {groups.map((g) => (
              <button
                key={g.spaceId}
                type="button"
                title={g.spaceName}
                aria-label={g.spaceName}
                aria-current={current === g.spaceId ? 'true' : undefined}
                onClick={() => {
                  if (query) setQuery('');
                  requestAnimationFrame(() => jumpTo(g.spaceId));
                }}
                className={cn(
                  'rounded-[10px] p-1 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand',
                  current === g.spaceId && 'bg-selected',
                )}
              >
                <SpaceIcon name={g.spaceName} iconUrl={g.iconUrl} size={28} />
              </button>
            ))}
          </nav>
          <div
            ref={scroller}
            onScroll={onScroll}
            onKeyDown={onGridKey}
            className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin"
          >
            {shown.length === 0 ? (
              <p className="px-2 py-10 text-center text-[14px] text-muted" role="status">
                No stickers match “{query.trim()}”
              </p>
            ) : (
              shown.map((g) => <Section key={g.spaceId} group={g} onPick={onPick} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  group,
  onPick,
}: {
  group: SpaceStickerGroup;
  onPick: (s: SpaceSticker) => void;
}) {
  return (
    <section
      data-space-section={group.spaceId}
      aria-label={group.spaceName}
      className="[contain-intrinsic-size:auto_240px] [content-visibility:auto]"
    >
      <h3 className="sticky top-0 z-[1] flex items-center gap-1.5 bg-elevated px-1 pt-2 pb-1.5 text-[12px] font-bold tracking-wide text-muted uppercase">
        <SpaceIcon name={group.spaceName} iconUrl={group.iconUrl} size={16} />
        <span className="truncate">{group.spaceName}</span>
      </h3>
      <div className="grid grid-cols-4 gap-1">
        {group.stickers.map((s) => (
          <Cell key={s.id} sticker={s} onPick={onPick} />
        ))}
      </div>
    </section>
  );
}

function Cell({ sticker, onPick }: { sticker: SpaceSticker; onPick: (s: SpaceSticker) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const playing = useStickerPlayback(ref, sticker.animated, 'self');
  return (
    <button
      ref={ref}
      type="button"
      data-sticker-cell
      title={sticker.name}
      aria-label={sticker.name}
      onClick={() => onPick(sticker)}
      className="flex aspect-square items-center justify-center rounded-lg p-1 transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
    >
      <StickerImage
        url={sticker.url}
        animated={sticker.animated}
        playing={playing}
        alt=""
        size={76}
        className="max-h-full max-w-full"
      />
    </button>
  );
}

function EmptyNote({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">
        <StickerIcon size={24} aria-hidden />
      </span>
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="text-[13px] text-muted">{text}</p>
    </div>
  );
}
