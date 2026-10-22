import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** One editor field: an uppercase label, the controls and an optional hint (no dividers). */
export function FormSection({
  title,
  hint,
  children,
  className,
  testId,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-2.5', className)} data-testid={testId}>
      <h3 className="section-label">{title}</h3>
      {children}
      {hint ? <p className="text-[12.5px] leading-relaxed text-muted">{hint}</p> : null}
    </section>
  );
}
