/** Recording UI shown in place of the text field while a voice note is being recorded. */
import { useEffect, useState } from 'react';
import { ChevronLeft, Lock, Trash2 } from 'lucide-react';
import { formatDuration } from '@enbox/shared';
import { IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { VoiceRecording } from '../lib/recorder';

const LIVE_BARS = 42;

export function VoiceRecorderBar({
  rec,
  locked,
  onCancel,
}: {
  rec: VoiceRecording;
  locked: boolean;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [bars, setBars] = useState<number[]>([]);

  useEffect(() => {
    const t = setInterval(() => setElapsed(rec.elapsedMs), 200);
    rec.onLevel = (level) => setBars((b) => [...b.slice(-(LIVE_BARS - 1)), level]);
    return () => {
      clearInterval(t);
      rec.onLevel = undefined;
    };
  }, [rec]);

  return (
    <div
      className="flex min-h-12 flex-1 animate-fade-in items-center gap-2 rounded-3xl bg-surface-2 px-2"
      role="status"
      aria-live="polite"
      aria-label={`Recording voice message, ${formatDuration(elapsed)}`}
      data-testid="voice-recorder"
    >
      {locked ? (
        <IconButton
          icon={Trash2}
          label="Delete recording"
          onClick={onCancel}
          className="text-danger"
        />
      ) : null}
      <span className="flex items-center gap-2 pl-2 text-[15px] font-medium tabular-nums">
        <span className="size-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
        {formatDuration(elapsed)}
      </span>
      {locked ? (
        <span
          className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden px-2"
          aria-hidden
        >
          {bars.map((v, i) => (
            <span
              key={i}
              className="w-[3px] shrink-0 rounded-full bg-muted"
              style={{ height: `${Math.max(10, Math.min(100, v * 100 + 8))}%` }}
            />
          ))}
        </span>
      ) : (
        <span className="flex flex-1 items-center justify-center gap-1 text-[14px] text-muted">
          <ChevronLeft size={16} className="animate-pulse" aria-hidden />
          Slide to cancel
          <span className={cn('ml-3 hidden items-center gap-1 text-[12px] sm:inline-flex')}>
            <Lock size={12} aria-hidden /> Slide up to lock
          </span>
        </span>
      )}
    </div>
  );
}
