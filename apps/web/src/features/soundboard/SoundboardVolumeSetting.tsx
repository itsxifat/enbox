import { Volume2 } from 'lucide-react';
import { useSoundboard } from '@/stores/soundboard';

/**
 * Settings → Voice: how loud soundboard sounds play here (× each sound's own volume), 0-100%.
 * Kept on this device; 100% by default.
 */
export function SoundboardVolumeSetting() {
  const volume = useSoundboard((s) => s.volume);
  const pct = Math.round(volume * 100);
  return (
    <div className="flex min-h-13 items-center gap-4 rounded-lg px-3 py-2.5 lg:px-4">
      <Volume2 size={22} className="shrink-0 text-muted" aria-hidden />
      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[16px] leading-snug text-fg">Soundboard volume</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          aria-valuetext={`${pct}%`}
          onChange={(e) => useSoundboard.getState().setVolume(Number(e.target.value) / 100)}
          className="h-1.5 w-full cursor-pointer accent-[var(--brand)]"
          data-testid="soundboard-volume"
        />
      </label>
      <span className="w-11 shrink-0 text-right text-[13px] text-muted tabular-nums">{pct}%</span>
    </div>
  );
}
