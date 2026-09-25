/** Voice notes (waveform, speed) and audio files (progress bar) with the shared player. */
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Headphones, Mic, Pause, Play } from 'lucide-react';
import { formatDuration } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ClientMessage } from '@/stores/messages';
import { cycleRate, seekTo, togglePlay, usePlayer } from '../lib/audioPlayer';
import { fallbackWaveform, resampleWaveform } from '../lib/waveform';
import { ProgressRing } from './MediaBody';
import { cancelUpload } from '../lib/sendMedia';

const BARS = 36;

function useTrack(m: ClientMessage) {
  const media = m.media!;
  const id = m.clientId ?? m.id;
  const src = mediaUrl(m.localUrl ?? media.url) ?? '';
  const active = usePlayer((s) => s.id === id);
  const playing = usePlayer((s) => s.id === id && s.playing);
  const position = usePlayer((s) => (s.id === id ? s.position : 0));
  const liveDuration = usePlayer((s) => (s.id === id ? s.duration : 0));
  const rate = usePlayer((s) => s.rate);
  const durationS = liveDuration || (media.durationMs ?? 0) / 1000;
  const progress = durationS > 0 ? Math.min(1, position / durationS) : 0;
  return {
    id,
    src,
    active,
    playing,
    position,
    durationS,
    progress,
    rate,
    durationMs: media.durationMs,
  };
}

function Seekbar({
  label,
  progress,
  onSeek,
  children,
  className,
}: {
  label: string;
  progress: number;
  onSeek: (fraction: number) => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') onSeek(Math.min(1, progress + 0.05));
    else if (e.key === 'ArrowLeft') onSeek(Math.max(0, progress - 0.05));
    else return;
    e.preventDefault();
  };
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.stopPropagation();
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onSeek(at(e));
      }}
      onPointerMove={(e) => {
        if (dragging.current) onSeek(at(e));
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'relative flex cursor-pointer touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded',
        className,
      )}
    >
      {children}
    </div>
  );
}

function PlayButton({
  playing,
  onClick,
  label,
}: {
  playing: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={playing ? `Pause ${label}` : `Play ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-black/5 hover:text-fg dark:hover:bg-white/10"
    >
      {playing ? (
        <Pause size={26} className="fill-current" aria-hidden />
      ) : (
        <Play size={26} className="ml-0.5 fill-current" aria-hidden />
      )}
    </button>
  );
}

export function VoiceBody({
  m,
  mine,
  meta,
}: {
  m: ClientMessage;
  mine: boolean;
  meta?: ReactNode;
}) {
  const t = useTrack(m);
  const bars = resampleWaveform(
    m.media!.waveform?.length ? m.media!.waveform : fallbackWaveform(m.media!.id, BARS),
    BARS,
  );
  const uploading = !!m.pending && m.uploadProgress !== undefined && m.uploadProgress < 1;
  const shown = t.active && t.position > 0 ? t.position : t.durationS;
  return (
    <div className="flex w-[min(290px,70vw)] items-center gap-1.5 py-0.5" data-testid="voice-note">
      {uploading ? (
        <span className="shrink-0 scale-[0.8]">
          <ProgressRing
            value={m.uploadProgress ?? 0}
            onCancel={m.clientId ? () => cancelUpload(m.clientId!) : undefined}
          />
        </span>
      ) : (
        <PlayButton
          playing={t.playing}
          label="voice message"
          onClick={() => togglePlay(t.id, t.src, t.durationMs)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Seekbar
          label="Voice message position"
          progress={t.progress}
          onSeek={(f) => seekTo(t.id, t.src, f, t.durationMs)}
          className="h-8 gap-[2px]"
        >
          {bars.map((v, i) => {
            const played = (i + 0.5) / bars.length <= t.progress;
            return (
              <span
                key={i}
                className={cn(
                  'min-w-[2px] flex-1 rounded-full transition-colors duration-150',
                  played ? (mine ? 'bg-brand-ink' : 'bg-brand') : 'bg-current opacity-30',
                )}
                style={{ height: `${Math.max(12, Math.round(v * 100))}%` }}
              />
            );
          })}
          {t.active ? (
            <span
              className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow"
              style={{ left: `${t.progress * 100}%` }}
              aria-hidden
            />
          ) : null}
        </Seekbar>
        <span
          className={cn(
            'flex h-4 items-center gap-2 text-[11px] tabular-nums',
            mine ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
          )}
        >
          {formatDuration(shown * 1000)}
          {t.active ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cycleRate();
              }}
              aria-label={`Playback speed ${t.rate}×`}
              className="rounded-full bg-black/10 px-1.5 py-px text-[10px] font-semibold text-fg dark:bg-white/15"
            >
              {t.rate}×
            </button>
          ) : null}
          {meta ? <span className="ml-auto">{meta}</span> : null}
        </span>
      </div>
      <span className="relative ml-1 shrink-0">
        <UserAvatar userId={m.senderId} size={44} />
        <Mic
          size={16}
          strokeWidth={2.4}
          className={cn(
            'absolute -right-0.5 -bottom-0.5 rounded-full p-px',
            t.progress > 0 || t.playing ? 'text-brand-ink' : 'text-tick-read',
            'bg-transparent drop-shadow',
          )}
          aria-hidden
        />
      </span>
    </div>
  );
}

export function AudioFileBody({ m, mine }: { m: ClientMessage; mine: boolean }) {
  const t = useTrack(m);
  const uploading = !!m.pending && m.uploadProgress !== undefined && m.uploadProgress < 1;
  const shown = t.active && t.position > 0 ? t.position : t.durationS;
  return (
    <div className="flex w-[min(290px,70vw)] items-center gap-2 py-1">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-warning text-white">
        <Headphones size={22} aria-hidden />
      </span>
      {uploading ? (
        <span className="shrink-0 scale-[0.8]">
          <ProgressRing
            value={m.uploadProgress ?? 0}
            onCancel={m.clientId ? () => cancelUpload(m.clientId!) : undefined}
          />
        </span>
      ) : (
        <PlayButton
          playing={t.playing}
          label="audio"
          onClick={() => togglePlay(t.id, t.src, t.durationMs)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-[13px] font-medium">{m.media!.fileName ?? 'Audio'}</span>
        <Seekbar
          label="Audio position"
          progress={t.progress}
          onSeek={(f) => seekTo(t.id, t.src, f, t.durationMs)}
          className="h-3"
        >
          <span className="h-1 w-full rounded-full bg-current opacity-25" aria-hidden />
          <span
            className="absolute left-0 h-1 rounded-full bg-brand"
            style={{ width: `${t.progress * 100}%` }}
            aria-hidden
          />
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand"
            style={{ left: `${t.progress * 100}%` }}
            aria-hidden
          />
        </Seekbar>
        <span
          className={cn(
            'flex items-center gap-2 text-[11px] tabular-nums',
            mine ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
          )}
        >
          {formatDuration(shown * 1000)}
          {t.active ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cycleRate();
              }}
              aria-label={`Playback speed ${t.rate}×`}
              className="rounded-full bg-black/10 px-1.5 py-px text-[10px] font-semibold text-fg dark:bg-white/15"
            >
              {t.rate}×
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
