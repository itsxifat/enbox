import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUi, type Toast } from '@/stores/ui';

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info } as const;
const ICON_COLORS = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-brand-ink',
} as const;

/** Toasts with an action (Undo, Open…) stay long enough to be reached by keyboard. */
const ACTION_MIN_MS = 10_000;

function ToastView({ t }: { t: Toast }) {
  const dismiss = useUi((s) => s.dismissToast);
  // Hovering or focusing a toast pauses its timer (WCAG 2.2.1); leaving restarts it.
  const [paused, setPaused] = useState(false);
  const duration = t.duration && t.action ? Math.max(t.duration, ACTION_MIN_MS) : t.duration;
  useEffect(() => {
    if (!duration || paused) return;
    const id = setTimeout(() => dismiss(t.id), duration);
    return () => clearTimeout(id);
  }, [t.id, duration, paused, dismiss]);
  const Icon = ICONS[t.kind];
  return (
    <div
      role={t.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      className="pointer-events-auto flex w-full max-w-md animate-slide-down items-start gap-3 rounded-2xl border border-line bg-elevated px-4 py-3 text-fg shadow-elevated"
    >
      <Icon size={20} className={cn('mt-px shrink-0', ICON_COLORS[t.kind])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug font-medium">{t.message}</p>
        {t.description ? (
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{t.description}</p>
        ) : null}
      </div>
      {t.action ? (
        <button
          type="button"
          className="shrink-0 rounded-full px-2 py-0.5 text-[14px] font-semibold text-brand-ink hover:bg-hover"
          onClick={() => {
            t.action?.onClick();
            dismiss(t.id);
          }}
        >
          {t.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(t.id)}
        className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-hover hover:text-fg"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** Toast stack (top center). Mounted once in the root layout; use `toast.*` to show. */
export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-3 pt-[max(12px,env(safe-area-inset-top))]"
    >
      {toasts.map((t) => (
        <ToastView key={t.id} t={t} />
      ))}
    </div>
  );
}
