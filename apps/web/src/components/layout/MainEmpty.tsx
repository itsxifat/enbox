import type { ReactNode } from 'react';
import { LaptopMinimal } from 'lucide-react';
import { LogoMark } from '@/components/common/Logo';
import type { IconType } from '@/components/ui';

export interface MainEmptyProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Icon instead of the Enbox mark. */
  icon?: IconType;
}

/** Branded empty main pane (desktop) shown when nothing is selected. */
export function MainEmpty({
  title = 'Enbox for Web',
  description = 'Send and receive messages, share updates and call the people you care about — right from your browser.',
  icon: Icon,
}: MainEmptyProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center border-b-[6px] border-brand bg-app px-10 text-center">
      <div className="relative mb-8">
        <div
          className="absolute inset-0 -z-0 scale-150 rounded-full bg-brand/10 blur-2xl"
          aria-hidden
        />
        {Icon ? (
          <div className="relative flex size-28 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
            <Icon size={48} strokeWidth={1.5} aria-hidden />
          </div>
        ) : (
          <LogoMark size={96} className="relative drop-shadow-xl" />
        )}
      </div>
      <h2 className="text-[28px] font-light tracking-tight text-fg">{title}</h2>
      <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted">{description}</p>
      <p className="mt-10 flex items-center gap-1.5 text-[13px] text-subtle">
        <LaptopMinimal size={14} aria-hidden /> Your chats stay in sync across all your devices
      </p>
    </div>
  );
}
