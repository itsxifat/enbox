/**
 * Pieces shared by the Server Guide, Browse Channels and Channels & Roles pages: the pane
 * (a header like a channel's, phones get Back, and a scrolling body) and the guide's welcome
 * sign (also the settings preview).
 */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import type { Space } from '@enbox/shared';
import { IconButton } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { mediaUrl } from '@/lib/api';
import { SpaceIcon } from '@/features/spaces/community/SpaceIcon';

export function GuidePane({
  space,
  title,
  icon: Icon,
  actions,
  children,
  testId,
}: {
  space: Pick<Space, 'id'>;
  title: string;
  icon: LucideIcon;
  /** Header controls on the right. */
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid={testId}>
      <header className="flex min-h-14 shrink-0 items-center gap-2 px-3 pt-[env(safe-area-inset-top)]">
        {desktop ? null : (
          <IconButton
            icon={ArrowLeft}
            label="Back"
            variant="ghost"
            onClick={() => navigate(`/spaces/${space.id}`)}
          />
        )}
        <Icon size={22} className="shrink-0 text-muted" aria-hidden />
        <h1 className="min-w-0 flex-1 truncate text-[16px] font-bold text-fg">{title}</h1>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-2 pb-10 lg:px-8">
          {children}
        </div>
      </div>
    </div>
  );
}

/** The welcome sign: the Space's banner (or the brand colour), icon and name, title, subtitle. */
export function GuideWelcome({
  space,
  title,
  subtitle,
}: {
  space: Pick<Space, 'name' | 'iconUrl' | 'bannerUrl'>;
  title: string;
  subtitle: string | null;
}) {
  return (
    <section
      className="overflow-hidden rounded-2xl bg-surface-2"
      aria-label="Welcome"
      data-testid="guide-welcome"
    >
      <div className="relative h-28 bg-brand sm:h-36" aria-hidden>
        {space.bannerUrl ? (
          <img
            src={mediaUrl(space.bannerUrl)}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="size-full bg-[radial-gradient(circle_at_20%_20%,rgb(255_255_255/0.25),transparent_55%)]" />
        )}
      </div>
      <div className="px-5 pb-6">
        <SpaceIcon
          name={space.name}
          iconUrl={space.iconUrl}
          size={72}
          className="-mt-9 border-4 border-surface-2 shadow-sm"
        />
        <p className="mt-3 truncate text-[13px] font-semibold tracking-wide text-muted uppercase">
          {space.name}
        </p>
        <h2 className="mt-1 text-[24px] leading-tight font-bold break-words text-fg sm:text-[28px]">
          {title || 'Welcome!'}
        </h2>
        {subtitle ? (
          <p className="mt-2 text-[15px] break-words whitespace-pre-wrap text-muted">{subtitle}</p>
        ) : null}
      </div>
    </section>
  );
}
