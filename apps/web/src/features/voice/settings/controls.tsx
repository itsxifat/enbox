/**
 * Rows of Settings → Voice & Video (features/settings/VoiceSettingsPage.tsx): device pickers,
 * sliders, the mic test with its level meter and the manual input sensitivity — a threshold
 * slider over my live level (the mic test's while it runs, else my voice channel mic's).
 */
import { useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, toast, type IconType } from '@/components/ui';
import { cn } from '@/lib/cn';
import { deviceChoices, useMediaDevices } from '../devices';
import { LEVEL_FLOOR_DB, levelPercent, useVoiceInputLevel } from '../input/level';
import { startMicTest, stopMicTest, useMicTest } from '../micTest';

const ROW = 'flex items-center gap-4 rounded-lg px-3 py-2.5 lg:px-4';

/** A microphone, speaker or camera picker ('' = Default). */
export function DeviceRow({
  kind,
  icon: Icon,
  title,
  value,
  onChange,
  testId,
}: {
  kind: MediaDeviceKind;
  icon: IconType;
  title: string;
  value: string;
  onChange: (deviceId: string) => void;
  testId?: string;
}) {
  // Device names show once the browser may use the mic or camera: ask again then.
  const testing = useMicTest((s) => s.running);
  const devices = useMediaDevices(kind, testing);
  const choices = deviceChoices(kind, devices, value);
  const id = useId();
  return (
    <div className={ROW}>
      <Icon size={22} className="shrink-0 text-muted" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label htmlFor={id} className="text-[16px] leading-snug text-fg">
          {title}
        </label>
        <span className="relative flex items-center">
          <select
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg bg-surface-2 py-2 pr-9 pl-3 text-[14px] text-fg outline-none focus-visible:outline-2 focus-visible:outline-brand"
            data-testid={testId}
          >
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3 text-muted"
            aria-hidden
          />
        </span>
      </div>
    </div>
  );
}

/** A slider row: title, the value as text on the right. */
export function RangeRow({
  icon: Icon,
  title,
  description,
  min,
  max,
  step = 1,
  value,
  format,
  onChange,
  testId,
}: {
  icon: IconType;
  title: string;
  description?: ReactNode;
  min: number;
  max: number;
  step?: number;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  testId?: string;
}) {
  const text = format(value);
  return (
    <div className={ROW}>
      <Icon size={22} className="shrink-0 text-muted" aria-hidden />
      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[16px] leading-snug text-fg">{title}</span>
        {description ? (
          <span className="text-[13.5px] leading-snug text-muted">{description}</span>
        ) : null}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={text}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer accent-[var(--brand)]"
          data-testid={testId}
        />
      </label>
      <span className="w-14 shrink-0 text-right text-[13px] text-muted tabular-nums">{text}</span>
    </div>
  );
}

/** A live input level: green, or amber while under `threshold` (when given). */
export function LevelMeter({
  db,
  threshold,
  className,
}: {
  db: number | null;
  threshold?: number;
  className?: string;
}) {
  const under = threshold !== undefined && (db ?? LEVEL_FLOOR_DB) < threshold;
  return (
    <div
      role="meter"
      aria-label="Input level"
      aria-valuemin={LEVEL_FLOOR_DB}
      aria-valuemax={0}
      aria-valuenow={Math.round(db ?? LEVEL_FLOOR_DB)}
      className={cn('h-2 overflow-hidden rounded-full bg-surface-2', className)}
      data-testid="level-meter"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-75',
          under ? 'bg-warning' : 'bg-success',
        )}
        style={{ width: `${db === null ? 0 : levelPercent(db)}%` }}
      />
    </div>
  );
}

/** My level right now: the mic test's while it runs, else my voice channel mic's (or none). */
export function useLiveInputLevel(): number | null {
  const test = useMicTest((s) => (s.running ? s.level : null));
  const voice = useVoiceInputLevel((s) => s.db);
  return test ?? voice;
}

/** Discord's "Let's Check": hear yourself, see your level. */
export function MicTestRow() {
  const running = useMicTest((s) => s.running);
  const starting = useMicTest((s) => s.starting);
  const level = useMicTest((s) => s.level);
  const start = () => void startMicTest().catch((e: unknown) => toast.error(e));
  return (
    <div className="flex flex-col gap-3 px-3 py-3 lg:px-4">
      <p className="text-[14px] leading-snug text-muted">
        Having mic issues? Start a test and say something — we’ll play your voice back to you.
      </p>
      <div className="flex items-center gap-4">
        <Button
          variant={running ? 'secondary' : 'primary'}
          loading={starting}
          onClick={running ? stopMicTest : start}
          className="shrink-0"
          data-testid="mic-test"
        >
          {running ? 'Stop Testing' : 'Let’s Check'}
        </Button>
        <LevelMeter db={running ? level : null} className="min-w-0 flex-1" />
      </div>
    </div>
  );
}

/**
 * The manual input sensitivity: the threshold (dB) as a slider over my live level — green
 * where my voice gets through, amber where it does not.
 */
export function SensitivitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (db: number) => void;
}) {
  const level = useLiveInputLevel();
  const under = (level ?? LEVEL_FLOOR_DB) < value;
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 lg:px-4">
      <div className="relative h-6" data-testid="sensitivity">
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-surface-2">
          <div
            className={cn(
              'h-full transition-[width] duration-75',
              under ? 'bg-warning' : 'bg-success',
            )}
            style={{ width: `${level === null ? 0 : levelPercent(level)}%` }}
          />
        </div>
        <input
          type="range"
          min={LEVEL_FLOOR_DB}
          max={0}
          step={1}
          value={value}
          aria-label="Input sensitivity"
          aria-valuetext={`${value} dB`}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cn(
            'absolute inset-0 h-6 w-full cursor-pointer appearance-none bg-transparent',
            '[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-[var(--brand)]',
            '[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow [&::-moz-range-thumb]:ring-2 [&::-moz-range-thumb]:ring-[var(--brand)] [&::-moz-range-track]:bg-transparent',
          )}
          data-testid="sensitivity-threshold"
        />
      </div>
      <p className="text-[13px] text-muted">
        {level === null
          ? 'Start the mic test to see where your voice reaches.'
          : `Your mic turns on above ${value} dB.`}
      </p>
    </div>
  );
}
