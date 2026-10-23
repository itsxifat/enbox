/**
 * The soundboard picker (Discord's soundboard popout): a grid of sounds — the Space of my
 * voice channel first, then my other Spaces — with a search box. Clicking a tile plays it for
 * everyone in my channel (`POST …/sounds/:id/play`; the clip comes back as `voice:sound` and
 * plays here like everywhere else); the speaker button on a tile previews it only for me.
 * Lists load when the picker opens and stay live through `space:sounds`.
 */
import { useEffect, useMemo, useState } from 'react';
import { AudioLines, Volume2 } from 'lucide-react';
import { PERM, hasPerm, type ID, type Space, type SpaceSound } from '@enbox/shared';
import { EmojiGlyph } from '@/components/emoji/CustomEmoji';
import { Popover, SearchInput, Spinner, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { useSoundboard } from '@/stores/soundboard';
import { useSpaceList } from '@/stores/spaces';
import { playSoundboardSound } from './playback';

/** Play a sound for my voice channel (the server checks voice, mute and the cooldown). */
export async function playForChannel(sound: Pick<SpaceSound, 'id' | 'spaceId'>): Promise<void> {
  await api.post(`/api/spaces/${sound.spaceId}/sounds/${sound.id}/play`);
}

/** The Spaces in picker order: `first` (my voice channel's), then the others as listed. */
export function pickerSpaces(spaces: readonly Space[], first: ID | null): Space[] {
  const here = spaces.filter((s) => s.id === first);
  return [...here, ...spaces.filter((s) => s.id !== first)];
}

function SoundTile({ sound, onPlay }: { sound: SpaceSound; onPlay: (s: SpaceSound) => void }) {
  return (
    <div className="group relative" data-testid="soundboard-tile">
      <button
        type="button"
        onClick={() => onPlay(sound)}
        className="flex h-11 w-full items-center gap-2 rounded-lg bg-surface-2 py-1 pr-8 pl-2 text-left text-[13px] font-medium text-fg transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
        aria-label={`Play ${sound.name}`}
      >
        <span className="flex size-6 shrink-0 items-center justify-center text-[18px] leading-none" aria-hidden>
          {sound.emoji ? <EmojiGlyph emoji={sound.emoji} size={22} /> : <AudioLines size={16} className="text-muted" />}
        </span>
        <span className="min-w-0 flex-1 truncate">{sound.name}</span>
      </button>
      <button
        type="button"
        onClick={() => playSoundboardSound(sound)}
        aria-label={`Preview ${sound.name}`}
        title="Preview"
        className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-brand"
      >
        <Volume2 size={15} aria-hidden />
      </button>
    </div>
  );
}

export interface SoundboardPickerProps {
  anchor: HTMLElement | null;
  /** The Space of my voice channel (its sounds come first). */
  spaceId: ID | null;
  onClose: () => void;
}

export function SoundboardPicker({ anchor, spaceId, onClose }: SoundboardPickerProps) {
  const spaces = useSpaceList();
  const ordered = useMemo(() => pickerSpaces(spaces, spaceId), [spaces, spaceId]);
  const bySpace = useSoundboard((s) => s.bySpace);
  const generation = useSoundboard((s) => s.generation);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const ids = useMemo(() => ordered.map((s) => s.id), [ordered]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void useSoundboard
      .getState()
      .loadSpaces(ids)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [ids, generation]);

  const q = query.trim().toLowerCase();
  const groups = ordered
    .map((space) => ({
      space,
      sounds: (bySpace[space.id] ?? []).filter((s) => !q || s.name.toLowerCase().includes(q)),
    }))
    .filter((g) => g.sounds.length > 0);
  const here = ordered.find((s) => s.id === spaceId);
  const canAdd = !!here && hasPerm(here.myPermissions, PERM.MANAGE_EMOJI);

  const play = (sound: SpaceSound) => void playForChannel(sound).catch((e: unknown) => toast.error(e));

  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} placement="top" align="start" aria-label="Soundboard">
      <div className="flex max-h-[min(440px,70vh)] w-[min(340px,calc(100vw-24px))] flex-col gap-2 rounded-xl bg-elevated p-3 shadow-elevated" data-testid="soundboard-picker">
        <SearchInput value={query} onChange={setQuery} placeholder="Search sounds" aria-label="Search sounds" autoFocus />
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 scrollbar-thin">
          {groups.map((g) => (
            <section key={g.space.id} className="pb-3" aria-label={g.space.name}>
              <h3 className="section-label px-1 pb-1.5">{g.space.name}</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {g.sounds.map((s) => (
                  <SoundTile key={s.id} sound={s} onPlay={play} />
                ))}
              </div>
            </section>
          ))}
          {loading ? (
            <div className="flex justify-center py-3">
              <Spinner size={18} />
            </div>
          ) : groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-[13px] text-muted">
              {q
                ? 'No sounds match your search.'
                : canAdd
                  ? 'No sounds yet. Add some in Space Settings → Soundboard.'
                  : 'No sounds in your Spaces yet.'}
            </p>
          ) : null}
        </div>
      </div>
    </Popover>
  );
}
