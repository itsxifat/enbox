import { Suspense, useEffect, useState } from 'react';
import { AudioLines } from 'lucide-react';
import { IconButton, Tooltip } from '@/components/ui';
import { lazyNamed } from '@/lib/lazy';
import { cn } from '@/lib/cn';
import { useMyVoiceState, useVoice } from '@/stores/voice';
import { useVoiceSelf } from '@/stores/voiceSelf';

const LazySoundboardPicker = lazyNamed(() => import('./SoundboardPicker'), 'SoundboardPicker');

/** Why I cannot play sounds right now (null: I can). */
export function soundboardBlocked(o: {
  muted: boolean;
  deafened: boolean;
  suppressed?: boolean;
  serverMute?: boolean;
  serverDeaf?: boolean;
}): string | null {
  if (o.deafened || o.serverDeaf) return 'Undeafen to use the soundboard';
  if (o.suppressed) return 'Become a speaker to use the soundboard';
  if (o.serverMute) return 'A moderator muted you';
  if (o.muted) return 'Unmute to use the soundboard';
  return null;
}

/**
 * The soundboard button of the voice controls (`AudioLines`): opens the picker. Disabled, with
 * the reason as its tooltip, while I am muted or deafened or in a Stage audience. `panel`: the
 * labelled button of the Voice Connected panel; `bar`: a round button of a call's control bar.
 */
export function SoundboardButton({ look = 'panel', className }: { look?: 'panel' | 'bar'; className?: string }) {
  const connection = useVoice((s) => s.connection);
  const state = useMyVoiceState();
  const muted = useVoiceSelf((s) => s.muted);
  const deafened = useVoiceSelf((s) => s.deafened);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const mine = connection && state?.channelId === connection.channelId ? state : undefined;
  const blocked = soundboardBlocked({
    muted,
    deafened,
    suppressed: mine?.suppressed,
    serverMute: mine?.serverMute,
    serverDeaf: mine?.serverDeaf,
  });
  // Muting (or leaving) closes the picker for good: it does not pop up again on unmute.
  useEffect(() => {
    if (blocked || !connection) setAnchor(null);
  }, [blocked, connection]);
  if (!connection) return null;
  const open = !!anchor && !blocked;
  const toggle = (el: HTMLElement) => setAnchor((a) => (a ? null : el));
  return (
    <>
      <Tooltip label={blocked ?? 'Soundboard'} className={cn(look === 'panel' && 'w-full', className)}>
        {look === 'panel' ? (
          <button
            type="button"
            aria-pressed={open}
            aria-label={blocked ? `Soundboard: ${blocked}` : 'Soundboard'}
            disabled={!!blocked}
            onClick={(e) => toggle(e.currentTarget)}
            className={cn(
              'flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-[13px] font-medium disabled:pointer-events-none disabled:opacity-45',
              open ? 'bg-fg text-surface' : 'bg-surface-2 text-fg hover:bg-hover',
            )}
            data-testid="soundboard-button"
          >
            <AudioLines size={16} aria-hidden /> Sounds
          </button>
        ) : (
          <IconButton
            icon={AudioLines}
            label={blocked ? `Soundboard: ${blocked}` : 'Soundboard'}
            noTooltip
            variant={open ? 'brand' : 'solid'}
            className="size-12 rounded-full"
            disabled={!!blocked}
            onClick={(e) => toggle(e.currentTarget)}
            data-testid="soundboard-button"
          />
        )}
      </Tooltip>
      {open ? (
        <Suspense fallback={null}>
          <LazySoundboardPicker anchor={anchor} spaceId={connection.spaceId} onClose={() => setAnchor(null)} />
        </Suspense>
      ) : null}
    </>
  );
}
