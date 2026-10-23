import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { DISCOVERY_CATEGORIES, type DiscoverableSpace } from '@enbox/shared';
import { Button, buttonClasses } from '@/components/ui';
import { SpaceIcon } from '@/features/spaces/community/SpaceIcon';
import { mediaUrl } from '@/lib/api';

/** Brand gradients for Spaces without a banner (picked by id, so a Space keeps its own). */
const GRADIENTS = [
  'linear-gradient(135deg, var(--brand) 0%, #a855f7 100%)',
  'linear-gradient(135deg, #4a39c7 0%, var(--brand) 55%, #ec4899 100%)',
  'linear-gradient(135deg, var(--brand) 0%, #6366f1 50%, #22d3ee 100%)',
  'linear-gradient(135deg, #7c3aed 0%, var(--brand) 60%, #f472b6 100%)',
];

export function bannerGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length]!;
}

const CATEGORY_NAMES = new Map<string, string>(DISCOVERY_CATEGORIES.map((c) => [c.id, c.name]));

export function memberCountLabel(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'Member' : 'Members'}`;
}

/**
 * A discovery card (Discord's server card): banner or a brand gradient, the icon overlapping
 * it, name, three lines of description, member count, and Preview + Join (or Joined).
 */
export function SpaceCard({
  space,
  joining,
  onJoin,
  onOpen,
}: {
  space: DiscoverableSpace;
  joining: boolean;
  onJoin: () => void;
  onOpen: () => void;
}) {
  const category = space.category ? CATEGORY_NAMES.get(space.category) : undefined;
  return (
    <article
      aria-labelledby={`discover-${space.id}`}
      className="flex h-full flex-col overflow-hidden rounded-2xl bg-surface-2 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-elevated"
      data-testid="discover-card"
    >
      <div
        className="relative h-28 shrink-0 sm:h-32"
        style={space.bannerUrl ? undefined : { background: bannerGradient(space.id) }}
      >
        {space.bannerUrl ? (
          <img src={mediaUrl(space.bannerUrl)} alt="" className="size-full object-cover" draggable={false} />
        ) : null}
      </div>
      <div className="relative flex flex-1 flex-col px-4 pb-4">
        <SpaceIcon
          name={space.name}
          iconUrl={space.iconUrl}
          size={56}
          className="-mt-7 ring-[5px] ring-surface-2"
        />
        <h3 id={`discover-${space.id}`} className="mt-2 truncate text-[16px] font-bold text-fg">
          {space.name}
        </h3>
        {space.description ? (
          <p className="mt-1 line-clamp-3 text-[14px] leading-snug break-words text-muted">{space.description}</p>
        ) : null}
        {category || space.tags.length ? (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
            {category ? (
              <li className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-medium text-brand-ink">{category}</li>
            ) : null}
            {space.tags.slice(0, 3).map((t) => (
              <li key={t} className="rounded-full bg-surface px-2 py-0.5 text-[12px] text-muted">
                {t}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex items-center gap-3 pt-4">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
            <span className="size-2 shrink-0 rounded-full bg-subtle" aria-hidden />
            <span className="truncate">{memberCountLabel(space.memberCount)}</span>
          </span>
          {space.joined ? (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={Check}
              className="ml-auto"
              onClick={onOpen}
              aria-label={`Joined, open ${space.name}`}
            >
              Joined
            </Button>
          ) : (
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {/* Read its public channels first (features/preview). */}
              <Link
                to={`/preview/${space.id}`}
                className={buttonClasses('secondary', 'sm')}
                aria-label={`Preview ${space.name}`}
              >
                Preview
              </Link>
              <Button size="sm" loading={joining} onClick={onJoin} aria-label={`Join ${space.name}`}>
                Join
              </Button>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
