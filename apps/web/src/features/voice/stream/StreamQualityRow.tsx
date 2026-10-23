import { useId } from 'react';
import { ChevronDown, MonitorUp } from 'lucide-react';
import { STREAM_QUALITIES, isStreamQuality, useStreamQuality } from './quality';

/** Settings → Voice & Video: "Screen share quality" (Auto, 720p30, 1080p30, 1080p60). */
export function StreamQualityRow() {
  const quality = useStreamQuality((s) => s.quality);
  const setQuality = useStreamQuality((s) => s.setQuality);
  const id = useId();
  return (
    <div className="flex items-center gap-4 rounded-lg px-3 py-2.5 lg:px-4">
      <MonitorUp size={22} className="shrink-0 text-muted" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label htmlFor={id} className="text-[16px] leading-snug text-fg">
          Screen share quality
        </label>
        <span className="relative flex items-center">
          <select
            id={id}
            value={quality}
            onChange={(e) => {
              if (isStreamQuality(e.target.value)) setQuality(e.target.value);
            }}
            className="w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg bg-surface-2 py-2 pr-9 pl-3 text-[14px] text-fg outline-none focus-visible:outline-2 focus-visible:outline-brand"
            data-testid="stream-quality"
          >
            {STREAM_QUALITIES.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
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
