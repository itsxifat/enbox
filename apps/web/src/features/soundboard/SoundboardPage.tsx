/**
 * Space Settings → Soundboard (MANAGE_EMOJI): the upload requirements, "N of 48 slots used",
 * Upload Sound, and the list — each sound with a play button (a preview, only here), its emoji,
 * name, volume and uploader, Edit and Delete. A picked file is checked first (type, size, and
 * its length measured from the audio metadata: soundFile.ts), then named, given an emoji and a
 * volume (with a preview) before it is uploaded. The list stays live through `space:sounds`.
 */
import { Suspense, useEffect, useRef, useState } from 'react';
import { AudioLines, Pencil, Play, SmilePlus, Trash2, Upload, X } from 'lucide-react';
import {
  MAX_SOUND_BYTES,
  MAX_SOUND_DURATION_MS,
  SPACE_SOUND_LIMIT,
  formatBytes,
  userDisplayName,
  type Space,
  type SpaceSound,
} from '@enbox/shared';
import { EmojiGlyph } from '@/components/emoji/CustomEmoji';
import { Avatar, Button, Field, IconButton, Input, Modal, Spinner, confirm, toast } from '@/components/ui';
import { LazyEmojiPicker } from '@/features/conversation/lazy';
import { api } from '@/lib/api';
import { createObjectUrl, revokeObjectUrl } from '@/lib/media';
import { useSoundboard, useSpaceSounds } from '@/stores/soundboard';
import { useUser } from '@/stores/users';
import { playClip, playSoundboardSound, soundVolume } from './playback';
import { SOUND_ACCEPT, checkSoundFile, soundNameFromFile } from './soundFile';

const NAME_MIN = 2;
const NAME_MAX = 32;

/** A checked clip waiting for its name, emoji and volume. */
interface PickedFile {
  file: File;
  durationMs: number;
}

export function SoundboardPage({ space }: { space: Space }) {
  const list = useSpaceSounds(space.id);
  const input = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [editing, setEditing] = useState<SpaceSound | null>(null);
  const used = list?.length ?? 0;
  const full = used >= SPACE_SOUND_LIMIT;

  const pick = async (file: File) => {
    setError(null);
    setChecking(true);
    try {
      const check = await checkSoundFile(file);
      if (!check.ok) setError(check.error);
      else setPicked({ file, durationMs: check.durationMs });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="soundboard-page">
      <section className="flex flex-col gap-3">
        <p className="text-[14px] text-muted">
          Add up to {SPACE_SOUND_LIMIT} short sounds that members can play in voice channels for everyone there. They’re free for every
          Space.
        </p>
        <div className="card-inset flex flex-col gap-1 p-4 text-[13px] text-muted">
          <h3 className="mb-1 text-[12px] font-bold tracking-wide text-fg uppercase">Upload requirements</h3>
          <p>File type: MP3, OGG or WAV</p>
          <p>Max file size: {formatBytes(MAX_SOUND_BYTES)}</p>
          <p>Max length: {MAX_SOUND_DURATION_MS / 1000} seconds</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button leftIcon={Upload} loading={checking} disabled={full || !list} onClick={() => input.current?.click()} data-testid="sound-upload">
            Upload Sound
          </Button>
          <span className="text-[13px] text-muted" data-testid="sound-slots">
            {used} of {SPACE_SOUND_LIMIT} slots used
          </span>
        </div>
        {error ? (
          <p role="alert" className="text-[14px] text-danger" data-testid="sound-error">
            {error}
          </p>
        ) : null}
        <input
          ref={input}
          type="file"
          accept={SOUND_ACCEPT}
          hidden
          aria-label="Sound file"
          data-testid="sound-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void pick(file);
          }}
        />
      </section>

      {!list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="card-inset p-6 text-center text-[14px] text-muted">No sounds yet. Upload one to get started.</p>
      ) : (
        <section className="flex flex-col gap-2" aria-label="Sounds">
          <h3 className="text-[12px] font-bold tracking-wide text-muted uppercase">Sounds — {list.length}</h3>
          <ul className="card-inset flex flex-col p-1">
            {list.map((s) => (
              <SoundRow key={s.id} sound={s} space={space} onEdit={() => setEditing(s)} />
            ))}
          </ul>
        </section>
      )}

      {picked ? <SoundEditor space={space} picked={picked} onClose={() => setPicked(null)} /> : null}
      {editing ? <SoundEditor space={space} sound={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function SoundRow({ sound, space, onEdit }: { sound: SpaceSound; space: Space; onEdit: () => void }) {
  const uploader = useUser(sound.createdBy);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${sound.name}?`,
      message: 'It is removed from the soundboard for everyone.',
      confirmLabel: 'Delete Sound',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await useSoundboard.getState().remove(space.id, sound.id);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <li
      className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-hover data-[busy=true]:opacity-50"
      data-busy={busy}
      data-testid={`sound-row-${sound.name}`}
    >
      <IconButton icon={Play} label={`Play ${sound.name}`} variant="solid" size="sm" onClick={() => playSoundboardSound(sound)} />
      <span className="flex size-8 shrink-0 items-center justify-center text-[22px] leading-none" aria-hidden>
        {sound.emoji ? <EmojiGlyph emoji={sound.emoji} size={22} /> : <AudioLines size={18} className="text-muted" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium text-fg">{sound.name}</span>
        <span className="truncate text-[12px] text-muted">
          Volume {Math.round(sound.volume * 100)}%{sound.createdBy ? ` · ${userDisplayName(uploader)}` : ''}
        </span>
      </span>
      {sound.createdBy ? (
        <Avatar src={uploader?.avatarUrl} name={userDisplayName(uploader)} colorSeed={sound.createdBy} size={24} decorative className="hidden sm:block" />
      ) : null}
      <IconButton icon={Pencil} label={`Edit ${sound.name}`} variant="ghost" size="sm" disabled={busy} onClick={onEdit} />
      <IconButton icon={Trash2} label={`Delete ${sound.name}`} variant="ghost" size="sm" disabled={busy} className="text-danger" onClick={() => void remove()} />
    </li>
  );
}

/** Add a picked file as a sound, or edit a sound's name, emoji and volume. */
function SoundEditor({
  space,
  picked,
  sound,
  onClose,
}: {
  space: Space;
  picked?: PickedFile;
  sound?: SpaceSound;
  onClose: () => void;
}) {
  const [name, setName] = useState(sound?.name ?? (picked ? soundNameFromFile(picked.file.name) : ''));
  const [emoji, setEmoji] = useState<string | null>(sound?.emoji ?? null);
  const [volume, setVolume] = useState(sound?.volume ?? 1);
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!picked) return;
    const url = createObjectUrl(picked.file);
    setLocalUrl(url);
    return () => revokeObjectUrl(url);
  }, [picked]);

  const preview = () => {
    const level = soundVolume({ volume });
    if (localUrl) playClip(localUrl, level);
    else if (sound) playSoundboardSound({ ...sound, volume });
  };

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
      setNameError(`Names need ${NAME_MIN} to ${NAME_MAX} characters.`);
      return;
    }
    setBusy(true);
    try {
      if (sound) {
        await useSoundboard.getState().update(space.id, sound.id, { name: trimmed, emoji, volume });
      } else if (picked) {
        const media = await api.upload(picked.file, { kind: 'audio', durationMs: picked.durationMs });
        await useSoundboard.getState().create(space.id, { name: trimmed, emoji, volume, mediaId: media.id });
      }
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const pct = Math.round(volume * 100);
  return (
    <Modal
      open
      onClose={onClose}
      title={sound ? 'Edit Sound' : 'Add Sound'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void save()} data-testid="sound-save">
            {sound ? 'Save Changes' : 'Upload'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Sound name" htmlFor="sound-name" error={nameError ?? undefined}>
          <Input
            id="sound-name"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            autoFocus
            data-testid="sound-name"
          />
        </Field>
        <Field label="Related emoji" htmlFor="sound-emoji">
          <div className="flex items-center gap-2">
            <button
              id="sound-emoji"
              type="button"
              aria-expanded={choosing}
              onClick={() => setChoosing((c) => !c)}
              className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-xl bg-surface-2 px-3 text-[20px] hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
              aria-label={emoji ? 'Change emoji' : 'Choose an emoji'}
            >
              {emoji ? <EmojiGlyph emoji={emoji} size={22} /> : <SmilePlus size={20} className="text-muted" aria-hidden />}
            </button>
            {emoji ? <IconButton icon={X} label="Remove emoji" variant="ghost" size="sm" onClick={() => setEmoji(null)} /> : null}
          </div>
          {choosing ? (
            <div className="card-inset mt-2 h-[320px] overflow-hidden">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Spinner />
                  </div>
                }
              >
                <LazyEmojiPicker
                  height="100%"
                  custom
                  onPick={(e) => {
                    setEmoji(e);
                    setChoosing(false);
                  }}
                />
              </Suspense>
            </div>
          ) : null}
        </Field>
        <Field label={`Volume: ${pct}%`} htmlFor="sound-volume">
          <div className="flex items-center gap-3">
            <input
              id="sound-volume"
              type="range"
              min={0}
              max={100}
              step={1}
              value={pct}
              aria-valuetext={`${pct}%`}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--brand)]"
            />
            <Button size="sm" variant="secondary" leftIcon={Play} onClick={preview} data-testid="sound-preview">
              Preview
            </Button>
          </div>
        </Field>
        {picked ? (
          <p className="text-[13px] text-muted">
            {picked.file.name} · {(picked.durationMs / 1000).toFixed(1)} s · {formatBytes(picked.file.size)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
