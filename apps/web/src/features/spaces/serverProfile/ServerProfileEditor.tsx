/**
 * Per-Space profile editor (Discord's Per-server Profile): nickname, avatar, banner, pronouns,
 * About Me, profile theme and the cosmetics, each overriding my main profile in one Space only.
 * Every field has "Reset to main profile" (null = follow the main profile). Edits stay a draft
 * — uploads included — behind the unsaved-changes bar; Save sends one `PATCH members/me` with
 * the changed fields, and the store updates `space.me` and my cached member, so my messages
 * and the member list change at once. Embedded in Settings → Profiles and in ServerProfileDialog.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';
import {
  AVATAR_MIME_TYPES,
  BIO_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  PERM,
  PRONOUNS_MAX_LENGTH,
  hasPerm,
  type MediaAttachment,
  type Space,
  type UserSelf,
} from '@enbox/shared';
import { Avatar, Button, EmptyState, Input, Textarea, toast } from '@/components/ui';
import { selfCardUser } from '@/features/profile/model';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { AvatarCropDialog } from '@/features/settings/profile/AvatarCropDialog';
import { BannerCropDialog } from '@/features/settings/profile/BannerCropDialog';
import { ColorPicker } from '@/features/settings/profile/ColorPicker';
import { UnsavedChangesBar } from '@/features/settings/profile/UnsavedChangesBar';
import { isAcceptedImage } from '@/features/settings/profile/avatar';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { useSpace } from '@/stores/spaces';
import { updateMyMember } from '../actions';
import { CosmeticGrid } from './CosmeticGrid';
import {
  RESET_VALUES,
  applyEdits,
  draftImageFromMedia,
  draftProfile,
  isOverridden,
  serverProfilePatch,
  type ServerProfileDraft,
  type ServerProfileEdits,
} from './draft';
import { withSpaceProfile } from './merge';

const IMAGE_ACCEPT = [...AVATAR_MIME_TYPES, 'image/gif', 'image/avif', 'image/heic'].join(',');

export interface ServerProfileEditorProps {
  spaceId: string;
  /** The host's leave guard (ServerProfileDialog asks before discarding). */
  onDirtyChange?: (dirty: boolean) => void;
  className?: string;
}

export function ServerProfileEditor({ spaceId, onDirtyChange, className }: ServerProfileEditorProps) {
  const space = useSpace(spaceId);
  const me = useMe();
  if (!space || !me)
    return (
      <EmptyState
        title="Space not available"
        description="Join the Space to set a profile for it."
        className={className}
      />
    );
  // A new Space starts a new draft.
  return <Editor key={spaceId} space={space} me={me} onDirtyChange={onDirtyChange} className={className} />;
}

function Editor({
  space,
  me,
  onDirtyChange,
  className,
}: {
  space: Space;
  me: UserSelf;
  onDirtyChange?: (dirty: boolean) => void;
  className?: string;
}) {
  const [edits, setEdits] = useState<ServerProfileEdits>({});
  const [saving, setSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const draft = useMemo(() => applyEdits(space.me, edits), [space.me, edits]);
  const patch = useMemo(() => serverProfilePatch(space.me, draft), [space.me, draft]);
  const dirty = Object.keys(patch).length > 0;
  const canNick = hasPerm(space.myPermissions, PERM.CHANGE_NICKNAME);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const edit = <K extends keyof ServerProfileDraft>(k: K, v: ServerProfileDraft[K]) =>
    setEdits((e) => ({ ...e, [k]: v }));
  const reset = (k: keyof ServerProfileDraft) => edit(k, RESET_VALUES[k]);

  const save = async () => {
    setSaving(true);
    try {
      await updateMyMember(space.id, patch);
      setEdits({});
      toast.success('Per-server profile saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const mainUser = selfCardUser(me);
  const preview = withSpaceProfile(mainUser, draftProfile(draft), draft.nickname);
  const resetButton = (k: keyof ServerProfileDraft, what = 'Reset to main profile') =>
    isOverridden(draft, k) ? (
      <button
        type="button"
        onClick={() => reset(k)}
        className="inline-flex items-center gap-1 rounded text-[13px] font-medium text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand"
        data-testid={`reset-${k}`}
      >
        <RotateCcw size={13} aria-hidden /> {what}
      </button>
    ) : (
      <span className="text-[12px] text-subtle">Using main profile</span>
    );

  const pickImage = (set: (f: File) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!isAcceptedImage(f)) {
      toast.error('Choose an image (JPEG, PNG, WebP or GIF).');
      return;
    }
    set(f);
  };
  const stage = (k: 'avatar' | 'banner') => (media: MediaAttachment) => edit(k, draftImageFromMedia(media));

  return (
    <div className={cn('@container flex flex-col gap-4', className)} data-testid="server-profile-editor" data-space-id={space.id}>
      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Server Nickname" htmlFor="sp-nickname" aside={canNick ? resetButton('nickname') : null}>
            <Input
              id="sp-nickname"
              value={draft.nickname}
              maxLength={NICKNAME_MAX_LENGTH}
              placeholder={me.displayName}
              disabled={!canNick}
              onChange={(e) => edit('nickname', e.target.value)}
              hint={canNick ? undefined : 'You can’t change your nickname in this Space.'}
            />
          </Section>

          <Section title="Server Avatar" aside={resetButton('avatar')}>
            <ImageRow
              preview={
                <Avatar
                  src={draft.avatar?.url ?? me.avatarUrl}
                  animatedSrc={draft.avatar ? draft.avatar.animatedUrl : me.avatarAnimatedUrl}
                  name={draft.nickname.trim() || me.displayName}
                  colorSeed={me.id}
                  size={64}
                  decorative={false}
                />
              }
              label={draft.avatar ? 'Change Avatar' : 'Upload Avatar'}
              inputLabel="Server avatar file"
              onFile={pickImage(setAvatarFile)}
              testId="server-avatar-input"
            />
          </Section>

          <Section title="Server Banner" aside={resetButton('banner')}>
            <ImageRow
              preview={<BannerThumb url={draft.banner?.url ?? me.bannerUrl ?? null} />}
              label={draft.banner ? 'Change Banner' : 'Upload Banner'}
              inputLabel="Server banner file"
              onFile={pickImage(setBannerFile)}
              testId="server-banner-input"
            />
          </Section>

          <Section title="Pronouns" htmlFor="sp-pronouns" aside={resetButton('pronouns')}>
            <Input
              id="sp-pronouns"
              value={draft.pronouns}
              maxLength={PRONOUNS_MAX_LENGTH}
              placeholder={me.pronouns || 'Add your pronouns'}
              onChange={(e) => edit('pronouns', e.target.value)}
            />
          </Section>

          <Section
            title="About Me"
            htmlFor="sp-bio"
            aside={resetButton('bio')}
            hint={`${draft.bio.length}/${BIO_MAX_LENGTH}`}
          >
            <Textarea
              id="sp-bio"
              value={draft.bio}
              maxLength={BIO_MAX_LENGTH}
              rows={3}
              placeholder={me.bio || 'Tell this Space about yourself'}
              onChange={(e) => edit('bio', e.target.value)}
            />
          </Section>

          <Section
            title="Profile Theme"
            aside={
              isOverridden(draft, 'profileColor') || isOverridden(draft, 'accentColor') ? (
                <button
                  type="button"
                  onClick={() => setEdits((e) => ({ ...e, profileColor: null, accentColor: null }))}
                  className="inline-flex items-center gap-1 rounded text-[13px] font-medium text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand"
                  data-testid="reset-theme"
                >
                  <RotateCcw size={13} aria-hidden /> Reset to main profile
                </button>
              ) : (
                <span className="text-[12px] text-subtle">Using main profile</span>
              )
            }
          >
            <div className="grid gap-4 @md:grid-cols-2">
              <ColorPicker
                label="Primary"
                value={draft.profileColor}
                fallback={me.profileColor ?? '#6d5dfc'}
                onChange={(c) => edit('profileColor', c)}
              />
              <ColorPicker
                label="Accent"
                value={draft.accentColor}
                fallback={me.accentColor ?? me.profileColor ?? '#6d5dfc'}
                onChange={(c) => edit('accentColor', c)}
              />
            </div>
          </Section>

          {(
            [
              ['avatarDecoration', 'decoration', 'Avatar Decoration'],
              ['profileEffect', 'effect', 'Profile Effect'],
              ['nameplate', 'nameplate', 'Nameplate'],
            ] as const
          ).map(([field, kind, title]) => (
            <Section key={field} title={title} aside={resetButton(field)}>
              <CosmeticGrid
                kind={kind}
                label={title}
                value={draft[field]}
                mainValue={me[field]}
                onChange={(id) => edit(field, id)}
                me={{ id: me.id, name: preview.displayName, avatarUrl: preview.avatarUrl }}
              />
            </Section>
          ))}
        </div>

        <aside className="order-first flex flex-col gap-2 @3xl:order-none" aria-label="Preview">
          <h3 className="section-label">Preview</h3>
          <div className="@3xl:sticky @3xl:top-2">
            <ProfileCard user={preview} self preview className="rounded-2xl border border-line" />
          </div>
        </aside>
      </div>

      <UnsavedChangesBar open={dirty} saving={saving} onReset={() => setEdits({})} onSave={() => void save()} />

      <AvatarCropDialog
        file={avatarFile}
        onClose={() => setAvatarFile(null)}
        onUploaded={stage('avatar')}
        successToast={null}
      />
      <BannerCropDialog
        file={bannerFile}
        onClose={() => setBannerFile(null)}
        onUploaded={stage('banner')}
        successToast={null}
      />
    </div>
  );
}

function Section({
  title,
  htmlFor,
  aside,
  hint,
  children,
}: {
  title: string;
  htmlFor?: string;
  aside?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="section-label">
            {title}
          </label>
        ) : (
          <h3 className="section-label">{title}</h3>
        )}
        {aside}
      </div>
      {children}
      {hint ? <p className="self-end text-[12px] text-subtle">{hint}</p> : null}
    </section>
  );
}

function ImageRow({
  preview,
  label,
  inputLabel,
  onFile,
  testId,
}: {
  preview: ReactNode;
  label: string;
  inputLabel: string;
  onFile: (e: ChangeEvent<HTMLInputElement>) => void;
  testId: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="card-inset flex items-center gap-4 p-3">
      {preview}
      <Button variant="soft" size="sm" leftIcon={ImagePlus} onClick={() => ref.current?.click()}>
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        aria-label={inputLabel}
        onChange={onFile}
        data-testid={testId}
      />
    </div>
  );
}

function BannerThumb({ url }: { url: string | null }) {
  const src = mediaUrl(url);
  return (
    <span className="block aspect-[5/2] w-32 shrink-0 overflow-hidden rounded-lg bg-surface-2" aria-hidden>
      {src ? <img src={src} alt="" className="size-full object-cover" draggable={false} /> : null}
    </span>
  );
}
