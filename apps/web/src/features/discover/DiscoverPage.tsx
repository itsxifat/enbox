/**
 * /discover — Space discovery (Discord's Discover): a hero with the search box, category
 * chips, then a grid of listed Spaces (the biggest first) that pages in as you scroll. Join
 * opens the Space (onboarding and the welcome screen take over from there); Joined opens it.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Compass, Link2, RefreshCw, SearchX } from 'lucide-react';
import { DISCOVERY_CATEGORIES, type DiscoveryCategory, type ID } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, EmptyState, SearchInput, Skeleton, Spinner, toast } from '@/components/ui';
import { JoinSpaceDialog } from '@/features/spaces/dialogs/JoinSpaceDialog';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/cn';
import { hasMoreSpaces, useDiscover } from '@/stores/discover';
import { SpaceCard } from './SpaceCard';

const SEARCH_DEBOUNCE_MS = 300;

function CategoryChips({
  value,
  onChange,
}: {
  value: DiscoveryCategory | null;
  onChange: (v: DiscoveryCategory | null) => void;
}) {
  const chips: { id: DiscoveryCategory | null; name: string }[] = [{ id: null, name: 'All' }, ...DISCOVERY_CATEGORIES];
  return (
    <div
      role="group"
      aria-label="Categories"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      {chips.map((c) => {
        const on = value === c.id;
        return (
          <button
            key={c.id ?? 'all'}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c.id)}
            className={cn(
              'h-9 shrink-0 rounded-full px-4 text-[14px] font-semibold whitespace-nowrap transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              on ? 'bg-brand text-on-brand' : 'bg-surface-2 text-fg hover:bg-hover',
            )}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

function CardSkeleton() {
  return (
    <li className="overflow-hidden rounded-2xl bg-surface-2" aria-hidden>
      <Skeleton className="h-28 w-full rounded-none sm:h-32" />
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="-mt-11 size-14 rounded-2xl" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </li>
  );
}

export function DiscoverPage() {
  const navigate = useNavigate();
  const status = useDiscover((s) => s.status);
  const spaces = useDiscover((s) => s.spaces);
  const total = useDiscover((s) => s.total);
  const error = useDiscover((s) => s.error);
  const joining = useDiscover((s) => s.joining);
  const loadingMore = useDiscover((s) => s.loadingMore);
  const more = useDiscover(hasMoreSpaces);
  const [text, setText] = useState(() => useDiscover.getState().query);
  const [category, setCategory] = useState<DiscoveryCategory | null>(() => useDiscover.getState().category);
  const [inviting, setInviting] = useState(false);
  const query = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Every change of the search (and opening the page) runs it again.
  useEffect(() => {
    void useDiscover.getState().search(query, category);
  }, [query, category]);

  // Infinite paging: the next page loads before the end of the grid scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void useDiscover.getState().loadMore();
      },
      { root: scrollRef.current, rootMargin: '0px 0px 600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [status, spaces.length, more]);

  const open = (id: ID) => void navigate(`/spaces/${id}`);
  const join = async (id: ID) => {
    try {
      open(await useDiscover.getState().join(id));
    } catch (e) {
      toast.error(e);
    }
  };

  const searching = !!query || !!category;
  const categoryName = DISCOVERY_CATEGORIES.find((c) => c.id === category)?.name;
  const heading = query
    ? `${total.toLocaleString()} ${total === 1 ? 'result' : 'results'} for “${query}”${categoryName ? ` in ${categoryName}` : ''}`
    : (categoryName ?? 'Featured Spaces');
  const firstLoad = status === 'loading' || (status === 'idle' && spaces.length === 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="lg:hidden">
        <PaneHeader title="Explore Spaces" back="/spaces" border />
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 pt-4 pb-10 lg:px-8 lg:pt-8">
          <section
            className="relative overflow-hidden rounded-3xl px-5 py-10 text-white sm:px-10 sm:py-14"
            style={{ background: 'linear-gradient(135deg, var(--brand) 0%, #4a39c7 45%, #a855f7 100%)' }}
            aria-labelledby="discover-title"
          >
            <Compass
              aria-hidden
              size={220}
              strokeWidth={1}
              className="pointer-events-none absolute -top-10 -right-10 text-white/15"
            />
            <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
              <h1 id="discover-title" className="text-[26px] leading-tight font-extrabold sm:text-[34px]">
                Find your community on Enbox
              </h1>
              <p className="text-[15px] text-white/85 sm:text-[17px]">
                From gaming, to music, to learning, there’s a place for you.
              </p>
              <SearchInput
                value={text}
                onChange={setText}
                placeholder="Explore Spaces"
                aria-label="Search Spaces"
                className="mt-3 h-12! w-full bg-surface! shadow-elevated [&_input]:text-[16px]"
              />
              <button
                type="button"
                onClick={() => setInviting(true)}
                className="mt-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[14px] font-semibold text-white/90 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
              >
                <Link2 size={16} aria-hidden /> Have an invite already? Join a Space
              </button>
            </div>
          </section>

          <CategoryChips value={category} onChange={setCategory} />

          <section aria-labelledby="discover-results" aria-busy={firstLoad || loadingMore || undefined}>
            <h2 id="discover-results" className="mb-4 text-[18px] font-bold text-fg">
              {heading}
            </h2>
            {status === 'error' && spaces.length === 0 ? (
              <EmptyState
                icon={RefreshCw}
                title="Couldn’t load Spaces"
                description={error ?? undefined}
                action={
                  <Button variant="soft" onClick={() => void useDiscover.getState().search(query, category)}>
                    Try again
                  </Button>
                }
              />
            ) : status === 'ready' && spaces.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title={searching ? 'No Spaces found' : 'No Spaces to explore yet'}
                description={
                  searching
                    ? 'Try another search or category.'
                    : 'When Spaces turn on discovery in their settings, they show up here.'
                }
              />
            ) : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Spaces">
                {firstLoad && spaces.length === 0
                  ? Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)
                  : spaces.map((s) => (
                      <li key={s.id}>
                        <SpaceCard
                          space={s}
                          joining={!!joining[s.id]}
                          onJoin={() => void join(s.id)}
                          onOpen={() => open(s.id)}
                        />
                      </li>
                    ))}
              </ul>
            )}
            {status === 'ready' && more ? <div ref={sentinelRef} className="h-px" aria-hidden /> : null}
            {loadingMore ? (
              <div className="flex justify-center py-6 text-brand-ink">
                <Spinner />
              </div>
            ) : status === 'ready' && more && typeof IntersectionObserver === 'undefined' ? (
              <div className="flex justify-center py-6">
                <Button variant="soft" onClick={() => void useDiscover.getState().loadMore()}>
                  Show more
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
      <JoinSpaceDialog open={inviting} onClose={() => setInviting(false)} />
    </div>
  );
}
