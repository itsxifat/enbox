import { LogoMark } from '@/components/common/Logo';
import { Spinner } from '@/components/ui';

/** Full-screen boot splash (resolving the stored session). */
export function Splash({ message }: { message?: string | null }) {
  return (
    <div
      className="flex h-dvh flex-col items-center justify-center gap-8 bg-surface"
      role="status"
      aria-label="Loading Enbox"
    >
      <LogoMark size={80} className="animate-pop drop-shadow-lg" />
      <div className="flex h-6 items-center gap-2 text-sm text-muted">
        {message ? (
          <>
            <Spinner size={16} label={null} /> {message}
          </>
        ) : null}
      </div>
      <p className="absolute bottom-[max(24px,env(safe-area-inset-bottom))] text-xs font-semibold tracking-[0.3em] text-subtle uppercase">
        Enbox
      </p>
    </div>
  );
}
