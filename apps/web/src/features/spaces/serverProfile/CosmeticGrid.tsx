import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  AVATAR_DECORATIONS,
  NAMEPLATES,
  PROFILE_EFFECTS,
  cosmeticName,
  type CosmeticItem,
} from '@enbox/shared';
import { Nameplate, ProfileEffect } from '@/components/cosmetics';
import { Avatar } from '@/components/ui';
import { cn } from '@/lib/cn';

export type CosmeticKind = 'decoration' | 'effect' | 'nameplate';

const ITEMS: Record<CosmeticKind, readonly CosmeticItem[]> = {
  decoration: AVATAR_DECORATIONS,
  effect: PROFILE_EFFECTS,
  nameplate: NAMEPLATES,
};

const GRID: Record<CosmeticKind, string> = {
  decoration: 'grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]',
  effect: 'grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]',
  nameplate: 'grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]',
};

export interface CosmeticGridProps {
  kind: CosmeticKind;
  label: string;
  /** The override (null = use the main profile's). */
  value: string | null;
  /** The main profile's choice (what null means). */
  mainValue: string | null | undefined;
  onChange: (id: string | null) => void;
  /** Who wears the previews. */
  me: { id: string; name: string; avatarUrl: string | null };
}

/**
 * A picker grid over the shared catalogue: "Use main profile" first, then every item with a
 * small preview. A radio group: arrow keys move and select, Home / End jump.
 */
export function CosmeticGrid({ kind, label, value, mainValue, onChange, me }: CosmeticGridProps) {
  const items = ITEMS[kind];
  const ids: (string | null)[] = [null, ...items.map((i) => i.id)];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, ids.indexOf(value));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = refs.current.findIndex((el) => el === document.activeElement);
    if (i < 0) return;
    let j: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = Math.min(ids.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = ids.length - 1;
    if (j === null) return;
    e.preventDefault();
    refs.current[j]?.focus();
    onChange(ids[j]!);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('grid max-h-72 gap-2 overflow-y-auto p-0.5', GRID[kind])}
      data-testid={`cosmetic-grid-${kind}`}
    >
      {ids.map((id, i) => (
        <Tile
          key={id ?? 'main'}
          ref={(el) => {
            refs.current[i] = el;
          }}
          checked={i === selected}
          tabIndex={i === selected ? 0 : -1}
          onSelect={() => onChange(id)}
          label={id ? (items.find((x) => x.id === id)?.name ?? id) : 'Use main profile'}
          sublabel={id ? undefined : (cosmeticName(kind, mainValue) ?? 'None')}
        >
          {id ? (
            <Preview kind={kind} id={id} me={me} />
          ) : (
            <span className="flex h-12 items-center justify-center text-muted">
              <RotateCcw size={20} aria-hidden />
            </span>
          )}
        </Tile>
      ))}
    </div>
  );
}

function Tile({
  ref,
  checked,
  tabIndex,
  onSelect,
  label,
  sublabel,
  children,
}: {
  ref: (el: HTMLButtonElement | null) => void;
  checked: boolean;
  tabIndex: number;
  onSelect: () => void;
  label: string;
  sublabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={sublabel ? `${label} (${sublabel})` : label}
      tabIndex={tabIndex}
      onClick={onSelect}
      data-animate-avatars
      className={cn(
        'card-inset flex min-w-0 flex-col items-stretch gap-1.5 p-2 text-left outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand',
        checked && 'ring-2 ring-brand',
      )}
    >
      {children}
      <span className="truncate text-center text-[12px] font-medium text-fg">{label}</span>
      {sublabel ? <span className="-mt-1 truncate text-center text-[11px] text-muted">{sublabel}</span> : null}
    </button>
  );
}

function Preview({ kind, id, me }: { kind: CosmeticKind; id: string; me: CosmeticGridProps['me'] }) {
  if (kind === 'decoration')
    return (
      <span className="flex h-12 items-center justify-center">
        <Avatar src={me.avatarUrl} name={me.name} colorSeed={me.id} size={36} decoration={id} animate="hover" />
      </span>
    );
  if (kind === 'effect')
    return (
      <span className="relative block h-12 overflow-hidden rounded-lg bg-surface-2">
        <ProfileEffect id={id} play="still" className="pointer-events-none absolute inset-0" />
      </span>
    );
  return (
    <span className="relative flex h-10 items-center gap-2 overflow-hidden rounded-lg bg-surface-2 px-2">
      <Nameplate id={id} className="absolute inset-0" animate="hover" />
      <span className="relative">
        <Avatar src={me.avatarUrl} name={me.name} colorSeed={me.id} size={24} />
      </span>
      <span className="relative truncate text-[12px] font-semibold text-fg">{me.name}</span>
    </span>
  );
}
