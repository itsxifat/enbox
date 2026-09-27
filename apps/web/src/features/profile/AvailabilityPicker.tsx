/**
 * My availability: Online / Idle / Do not disturb / Invisible, the last three for a duration
 * (30 min / 1 h / 8 h / until I change it) → PUT /api/me/presence. Lives on my own profile
 * card (NavRail avatar, the SettingsPane profile card on phones).
 */
import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { effectiveAvailability, type Availability } from '@enbox/shared';
import { Menu, Spinner, toast, type MenuEntry } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatShortDate, formatTime, isSameLocalDay } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { AVAILABILITY_DURATIONS, expiryFor, setAvailability } from './presenceApi';

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
  invisible: 'Invisible',
};

const DESCRIPTIONS: Record<Availability, string> = {
  online: 'People see you as online',
  idle: 'Shown as away',
  dnd: 'No sounds, notifications or ringtones',
  invisible: 'You appear offline',
};

const CHOICES: Availability[] = ['online', 'idle', 'dnd', 'invisible'];

/** Coloured dot matching the avatar badge: green / amber / red / hollow (invisible). */
export function AvailabilityDot({
  availability,
  className,
}: {
  availability: Availability;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-availability={availability}
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        availability === 'online' && 'bg-online',
        availability === 'idle' && 'bg-warning',
        availability === 'dnd' && 'bg-danger',
        availability === 'invisible' && 'border-2 border-line-strong',
        className,
      )}
    />
  );
}

function untilLabel(iso: string): string {
  const d = new Date(iso);
  return isSameLocalDay(d, new Date())
    ? `Until ${formatTime(d)}`
    : `Until ${formatShortDate(d)} ${formatTime(d)}`;
}

export function AvailabilityPicker({ className }: { className?: string }) {
  const me = useMe();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** A non-online choice waiting for its duration (the second menu). */
  const [pending, setPending] = useState<Availability | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const current = effectiveAvailability(me);
  const until = current !== 'online' ? me.availabilityUntil : null;

  const apply = async (availability: Availability, untilIso: string | null) => {
    setBusy(true);
    try {
      await setAvailability(availability, untilIso);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const stateItems: MenuEntry[] = CHOICES.map((a) => ({
    label: (
      <span className="flex items-center gap-3 py-0.5">
        <AvailabilityDot availability={a} className="size-3" />
        <span className="flex min-w-0 flex-col">
          <span className="text-[14.5px] leading-tight font-medium">{AVAILABILITY_LABELS[a]}</span>
          {/* Decorative: keeps the item's accessible name to the state label. */}
          <span className="text-[12px] leading-tight text-muted" aria-hidden>
            {DESCRIPTIONS[a]}
          </span>
        </span>
      </span>
    ),
    onSelect: () => (a === 'online' ? void apply('online', null) : setPending(a)),
  }));
  const durationItems: MenuEntry[] = AVAILABILITY_DURATIONS.map((d) => ({
    label: d.label,
    onSelect: () => {
      const a = pending;
      setPending(null);
      if (a) void apply(a, expiryFor(d.value));
    },
  }));

  return (
    <div className={cn('flex flex-col', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Availability: ${AVAILABILITY_LABELS[current]}`}
        onClick={() => setMenuOpen(true)}
        disabled={busy}
        className="card-inset flex min-h-11 w-full items-center gap-3 px-3 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60"
        data-testid="availability-picker"
      >
        <AvailabilityDot availability={current} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14.5px] leading-tight font-medium text-fg">
            {AVAILABILITY_LABELS[current]}
          </span>
          <span className="text-[12px] text-muted">
            {until ? untilLabel(until) : DESCRIPTIONS[current]}
          </span>
        </span>
        {busy ? (
          <Spinner size={14} label={null} />
        ) : (
          <ChevronDown size={16} className="shrink-0 text-subtle" aria-hidden />
        )}
      </button>
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={buttonRef.current}
        items={stateItems}
        align="start"
        aria-label="Availability"
        className="min-w-[260px] rounded-xl"
      />
      <Menu
        open={!!pending}
        onClose={() => setPending(null)}
        anchor={buttonRef.current}
        items={durationItems}
        align="start"
        aria-label={pending ? `${AVAILABILITY_LABELS[pending]} for how long?` : 'For how long?'}
      />
    </div>
  );
}
