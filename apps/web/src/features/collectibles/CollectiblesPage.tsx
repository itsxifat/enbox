/**
 * /collectibles: the free cosmetics gallery. A hero, category tabs (plus Favourites), and
 * every item grouped by collection. Cards animate only while hovered or focused; the one I
 * wear says "Equipped"; a click opens the details (try-on, Equip / Unequip); the heart keeps
 * a favourite on this device.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { Heart, Sparkles } from 'lucide-react';
import type { CosmeticCollection } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState, Tabs, type TabItem } from '@/components/ui';
import { selfCardUser, type ProfileCardUser } from '@/features/profile/model';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import {
  COLLECTIBLES,
  KIND_LABELS,
  collectiblesOf,
  groupByCollection,
  isEquipped,
  type Collectible,
  type CollectibleKind,
} from './catalog';
import { CollectibleDetailsModal } from './CollectibleDetailsModal';
import { useFavourites } from './favourites';
import { CollectibleThumb, DecorationPreview, useHot } from './previews';

type Tab = 'all' | CollectibleKind | 'favourites';

/** Header strip art per collection (white text on all of them). */
const COLLECTION_ART: Record<string, string> = {
  cosmic: 'linear-gradient(120deg, #1e1b4b 0%, #4c1d95 55%, #0e7490 100%)',
  nature: 'linear-gradient(120deg, #14532d 0%, #3f6212 50%, #9d174d 100%)',
  elemental: 'linear-gradient(120deg, #7c2d12 0%, #9a3412 40%, #1e40af 100%)',
  arcade: 'linear-gradient(120deg, #111827 0%, #5b21b6 55%, #be185d 100%)',
  cozy: 'linear-gradient(120deg, #7c2d12 0%, #9d174d 60%, #6d28d9 100%)',
  fantasy: 'linear-gradient(120deg, #3b0764 0%, #6d28d9 50%, #92400e 100%)',
  neon: 'linear-gradient(120deg, #0f172a 0%, #86198f 55%, #0e7490 100%)',
};

const PLURAL: Record<CollectibleKind, string> = {
  decoration: 'Avatar Decorations',
  effect: 'Profile Effects',
  nameplate: 'Nameplates',
  nameStyle: 'Name Styles',
};

export function CollectiblesPage() {
  const me = useMe();
  const desktop = useIsDesktop();
  const [tab, setTab] = useState<Tab>('all');
  const [open, setOpen] = useState<Collectible | null>(null);
  const favourites = useFavourites((s) => s.keys);
  const toggleFavourite = useFavourites((s) => s.toggle);
  if (!me) return null;
  const user = selfCardUser(me);

  const items =
    tab === 'all'
      ? COLLECTIBLES
      : tab === 'favourites'
        ? COLLECTIBLES.filter((c) => favourites.includes(c.key))
        : collectiblesOf(tab);
  const groups = groupByCollection(items);
  const tabs: TabItem<Tab>[] = [
    { value: 'all', label: 'All' },
    ...(Object.keys(PLURAL) as CollectibleKind[]).map((k) => ({ value: k, label: PLURAL[k] })),
    { value: 'favourites', label: 'Favourites', count: favourites.length || undefined },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="collectibles-page">
      <PaneHeader title="Collectibles" back={desktop ? undefined : '/settings/profile'} />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-3 pb-[max(32px,env(safe-area-inset-bottom))] lg:px-6">
          <Hero user={user} />
          <Tabs
            value={tab}
            onChange={setTab}
            items={tabs}
            variant="chips"
            aria-label="Categories"
            idBase="collectibles"
            className="-mx-3 px-3 lg:mx-0 lg:px-0"
          />
          <div
            role="tabpanel"
            id={`collectibles-panel-${tab}`}
            aria-labelledby={`collectibles-tab-${tab}`}
            className="flex flex-col gap-7"
          >
            {groups.length ? (
              groups.map((g) => (
                <CollectionSection
                  key={g.collection.id}
                  collection={g.collection}
                  items={g.items}
                  user={user}
                  favourites={favourites}
                  onOpen={setOpen}
                  onToggleFavourite={toggleFavourite}
                />
              ))
            ) : (
              <EmptyState
                icon={Heart}
                title="No favourites yet"
                description="Tap the heart on anything you like and it will wait for you here."
              />
            )}
          </div>
        </div>
      </div>
      <CollectibleDetailsModal item={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Hero({ user }: { user: ProfileCardUser }) {
  return (
    <section
      className="relative isolate flex items-center gap-6 overflow-hidden rounded-2xl px-5 py-7 text-white lg:px-8 lg:py-9"
      style={{ background: 'linear-gradient(120deg, #2f267d 0%, #6d5dfc 48%, #c026d3 100%)' }}
      aria-labelledby="collectibles-hero"
    >
      <Sparkles
        size={160}
        strokeWidth={1}
        className="pointer-events-none absolute -top-6 -right-6 -z-10 text-white/10"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <h2 id="collectibles-hero" className="text-[24px] leading-tight font-bold lg:text-[30px]">
          Collectibles — every item is free
        </h2>
        <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-white/85">
          Avatar decorations, profile effects, nameplates and name styles. Try anything on, equip it
          in a click and change it whenever you like.
        </p>
        <Link
          to="/settings/profile"
          className="mt-4 inline-flex h-9 items-center rounded-full bg-white px-4 text-[14px] font-semibold text-[#2f267d] outline-none hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Edit my profile
        </Link>
      </div>
      <div className="hidden shrink-0 sm:block" aria-hidden>
        <DecorationPreview user={user} id={user.avatarDecoration || 'orbit'} size={96} />
      </div>
    </section>
  );
}

function CollectionSection({
  collection,
  items,
  user,
  favourites,
  onOpen,
  onToggleFavourite,
}: {
  collection: CosmeticCollection;
  items: Collectible[];
  user: ProfileCardUser;
  favourites: string[];
  onOpen: (item: Collectible) => void;
  onToggleFavourite: (key: string) => void;
}) {
  const headingId = `collection-${collection.id}`;
  return (
    <section
      aria-labelledby={headingId}
      data-testid="collection-section"
      data-collection={collection.id}
    >
      <div
        className="mb-3 rounded-xl px-4 py-3 text-white"
        style={{ background: COLLECTION_ART[collection.id] ?? 'var(--brand)' }}
      >
        <h3 id={headingId} className="text-[17px] font-bold">
          {collection.name}
        </h3>
        <p className="text-[13px] text-white/80">{collection.description}</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {items.map((item) => (
          <li key={item.key}>
            <CollectibleCard
              item={item}
              user={user}
              equipped={isEquipped(user, item)}
              favourite={favourites.includes(item.key)}
              onOpen={() => onOpen(item)}
              onToggleFavourite={() => onToggleFavourite(item.key)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CollectibleCard({
  item,
  user,
  equipped,
  favourite,
  onOpen,
  onToggleFavourite,
}: {
  item: Collectible;
  user: ProfileCardUser;
  equipped: boolean;
  favourite: boolean;
  onOpen: () => void;
  onToggleFavourite: () => void;
}) {
  const [hot, handlers] = useHot();
  return (
    <div
      className="relative"
      {...handlers}
      data-testid="collectible-card"
      data-key={item.key}
      data-hot={hot || undefined}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${item.name}, ${KIND_LABELS[item.kind]}${equipped ? ', equipped' : ''}`}
        className={cn(
          'card-inset flex w-full flex-col gap-2 p-2 text-left transition-colors outline-none hover:bg-hover',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          equipped && 'ring-2 ring-brand',
        )}
      >
        <CollectibleThumb item={item} user={user} hot={hot} />
        <span className="min-w-0 px-1 pb-0.5">
          <span className="block truncate text-[14px] font-semibold text-fg">{item.name}</span>
          <span className="block truncate text-[12px] text-muted">{KIND_LABELS[item.kind]}</span>
        </span>
      </button>
      {equipped ? (
        <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-on-brand shadow-sm">
          Equipped
        </span>
      ) : null}
      <button
        type="button"
        aria-pressed={favourite}
        aria-label={
          favourite ? `Remove ${item.name} from favourites` : `Add ${item.name} to favourites`
        }
        onClick={onToggleFavourite}
        className={cn(
          'absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/35 text-white outline-none transition-opacity hover:bg-black/50 focus-visible:outline-2 focus-visible:outline-brand',
          favourite || hot ? 'opacity-100' : 'opacity-0 pointer-coarse:opacity-100',
        )}
      >
        <Heart
          size={16}
          fill={favourite ? 'currentColor' : 'none'}
          className={favourite ? 'text-rose-400' : undefined}
          aria-hidden
        />
      </button>
    </div>
  );
}
