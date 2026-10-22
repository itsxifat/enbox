import type { ISODate } from '@enbox/shared';
import { LogoMark } from '@/components/common/Logo';
import { Avatar } from '@/components/ui';
import { cn } from '@/lib/cn';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** "Jan 15, 2025" (locale order): profile "Member Since" dates. */
export function formatProfileDate(input: ISODate | Date, locale?: string): string {
  const key = locale ?? '';
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' });
    formatters.set(key, f);
  }
  return f.format(typeof input === 'string' ? new Date(input) : input);
}

export interface MemberSinceProps {
  /** Joined Enbox. */
  createdAt: ISODate;
  /** Space context: the Space and when they joined it. */
  space?: { id: string; name: string; iconUrl: string | null } | null;
  joinedAt?: ISODate | null;
  className?: string;
  labelClassName?: string;
}

/** "Member Since": the Enbox date (with the Enbox mark) and, in a Space, the Space's. */
export function MemberSince({ createdAt, space, joinedAt, className, labelClassName }: MemberSinceProps) {
  return (
    <section className={className} data-testid="card-member-since">
      <h3 className={cn('section-label mb-1.5', labelClassName)}>Member Since</h3>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-fg">
        <span className="inline-flex items-center gap-1.5" title="Joined Enbox">
          <LogoMark size={16} />
          <span className="sr-only">Enbox: </span>
          <span>{formatProfileDate(createdAt)}</span>
        </span>
        {space && joinedAt ? (
          <>
            <span aria-hidden className="size-1 rounded-full bg-subtle" />
            <span className="inline-flex items-center gap-1.5" title={`Joined ${space.name}`}>
              <Avatar kind="community" src={space.iconUrl} name={space.name} colorSeed={space.id} size={16} />
              <span className="sr-only">{space.name}: </span>
              <span data-testid="card-space-joined">{formatProfileDate(joinedAt)}</span>
            </span>
          </>
        ) : null}
      </div>
    </section>
  );
}
