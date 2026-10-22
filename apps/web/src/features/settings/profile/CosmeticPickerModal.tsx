import { useRef, useState, type KeyboardEvent } from 'react';
import { Ban } from 'lucide-react';
import { COSMETIC_COLLECTIONS } from '@enbox/shared';
import { Button, Modal } from '@/components/ui';
import {
  KIND_LABELS,
  collectiblesOf,
  groupByCollection,
  type Collectible,
} from '@/features/collectibles/catalog';
import {
  CollectibleThumb,
  DecorationPreview,
  MiniCard,
  NameplateRow,
  useHot,
} from '@/features/collectibles/previews';
import type { ProfileCardUser } from '@/features/profile/model';
import { cn } from '@/lib/cn';

export type PickerKind = 'decoration' | 'effect' | 'nameplate';

const TITLES: Record<PickerKind, string> = {
  decoration: 'Choose an Avatar Decoration',
  effect: 'Choose a Profile Effect',
  nameplate: 'Choose a Nameplate',
};

const GRID: Record<PickerKind, string> = {
  decoration: 'grid-cols-3 sm:grid-cols-4',
  effect: 'grid-cols-2 sm:grid-cols-3',
  nameplate: 'grid-cols-1 sm:grid-cols-2',
};

export interface CosmeticPickerModalProps {
  /** Which picker is open; null = closed. */
  kind: PickerKind | null;
  /** The draft's current choice. */
  value: string | null;
  /** My card as the draft has it (the previews wear the choice on it). */
  user: ProfileCardUser;
  /** Apply: the choice goes back to the draft (not saved). */
  onApply: (id: string | null) => void;
  onClose: () => void;
}

/**
 * Avatar decoration / profile effect / nameplate picker: "None" and every item grouped by
 * collection, with a live preview of the selection on my own profile. Arrow keys move (and
 * select) through the tiles, Home / End jump; Apply returns the choice, Esc cancels.
 */
export function CosmeticPickerModal(props: CosmeticPickerModalProps) {
  if (!props.kind) return null;
  return <PickerDialog key={props.kind} {...props} kind={props.kind} />;
}

function PickerDialog({
  kind,
  value,
  user,
  onApply,
  onClose,
}: CosmeticPickerModalProps & { kind: PickerKind }) {
  const items = collectiblesOf(kind);
  const groups = groupByCollection(items);
  const [selected, setSelected] = useState<string | null>(
    value && items.some((i) => i.id === value) ? value : null,
  );
  const gridRef = useRef<HTMLDivElement>(null);
  const current = items.find((i) => i.id === selected) ?? null;
  const collection = current
    ? COSMETIC_COLLECTIONS.find((c) => c.id === current.collection)
    : undefined;
  const label = KIND_LABELS[kind];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tiles = [...(gridRef.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
    const from = tiles.indexOf(document.activeElement as HTMLElement);
    if (from < 0) return;
    let to: number;
    if (e.key === 'ArrowRight') to = Math.min(tiles.length - 1, from + 1);
    else if (e.key === 'ArrowLeft') to = Math.max(0, from - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = tiles.length - 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp')
      to = verticalNeighbour(tiles, from, e.key === 'ArrowDown');
    else return;
    e.preventDefault();
    const tile = tiles[to];
    if (!tile) return;
    tile.focus();
    setSelected(tile.dataset.id || null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={TITLES[kind]}
      description="Every item is free. Pick one to preview it on your profile."
      size="xl"
      bodyClassName="px-4 sm:px-6"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onApply(selected);
              onClose();
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row-reverse">
        {/* Live preview of the selection. */}
        <div
          className="flex shrink-0 flex-col items-center gap-3 sm:w-56"
          data-testid="picker-preview"
        >
          <div className="card-inset flex w-full items-center justify-center p-4">
            {kind === 'decoration' ? (
              <DecorationPreview user={user} id={selected} size={112} />
            ) : kind === 'effect' ? (
              <MiniCard user={user} effect={selected} className="w-full max-w-56" />
            ) : (
              <NameplateRow user={user} id={selected} className="w-full" subtitle="Online" />
            )}
          </div>
          <div className="text-center">
            <p className="text-[15px] font-semibold text-fg" data-testid="picker-selection">
              {current?.name ?? 'None'}
            </p>
            <p className="text-[12.5px] text-muted">
              {collection ? `${collection.name} collection` : `No ${label.toLowerCase()}`}
            </p>
          </div>
        </div>

        <div
          ref={gridRef}
          role="radiogroup"
          aria-label={`${label}s`}
          onKeyDown={onKeyDown}
          className="flex min-w-0 flex-1 flex-col gap-4"
        >
          <div className={cn('grid gap-2', GRID[kind])}>
            <PickerTile
              item={null}
              user={user}
              checked={selected === null}
              onSelect={() => setSelected(null)}
            />
          </div>
          {groups.map((g) => (
            <section key={g.collection.id} aria-labelledby={`picker-${kind}-${g.collection.id}`}>
              <h3 id={`picker-${kind}-${g.collection.id}`} className="section-label mb-2 px-1">
                {g.collection.name}
              </h3>
              <div className={cn('grid gap-2', GRID[kind])}>
                {g.items.map((item) => (
                  <PickerTile
                    key={item.key}
                    item={item}
                    user={user}
                    checked={selected === item.id}
                    onSelect={() => setSelected(item.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function PickerTile({
  item,
  user,
  checked,
  onSelect,
}: {
  item: Collectible | null;
  user: ProfileCardUser;
  checked: boolean;
  onSelect: () => void;
}) {
  const [hot, handlers] = useHot();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={item?.name ?? 'None'}
      tabIndex={checked ? 0 : -1}
      data-id={item?.id ?? ''}
      data-hot={hot || undefined}
      onClick={onSelect}
      {...handlers}
      className={cn(
        'card-inset flex min-w-0 flex-col items-stretch gap-1 overflow-hidden p-1.5 text-left transition-colors outline-none hover:bg-hover',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        checked ? 'ring-2 ring-brand' : '',
      )}
    >
      {item ? (
        <CollectibleThumb item={item} user={user} hot={hot} />
      ) : (
        <span className="flex aspect-[4/3] items-center justify-center text-muted">
          <Ban size={28} aria-hidden />
        </span>
      )}
      <span className="truncate px-1 text-[12.5px] font-medium text-fg">
        {item?.name ?? 'None'}
      </span>
    </button>
  );
}

/** The tile below / above `from` closest in x (by layout; ±1 when there is no layout, e.g. jsdom). */
function verticalNeighbour(tiles: HTMLElement[], from: number, down: boolean): number {
  const r = tiles[from]!.getBoundingClientRect();
  let best = -1;
  let bestRow = Infinity;
  let bestDx = Infinity;
  tiles.forEach((t, i) => {
    const b = t.getBoundingClientRect();
    const dy = down ? b.top - r.top : r.top - b.top;
    if (dy <= 1) return;
    const dx = Math.abs(b.left - r.left);
    if (dy < bestRow - 1 || (Math.abs(dy - bestRow) <= 1 && dx < bestDx)) {
      best = i;
      bestRow = dy;
      bestDx = dx;
    }
  });
  if (best >= 0) return best;
  if (r.width || r.height) return from; // laid out: already on the first / last row
  return down ? Math.min(tiles.length - 1, from + 1) : Math.max(0, from - 1);
}
