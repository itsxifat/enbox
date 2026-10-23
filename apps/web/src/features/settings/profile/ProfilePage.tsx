/**
 * Settings → Profiles (Discord's two-column profile editor).
 *
 * - Main Profile: the form on the left, a sticky live preview on the right (on phones a
 *   collapsible preview card above the form). Every field edits a draft (`useProfileDraft`);
 *   nothing saves until Save Changes, which sends one `PATCH /api/me` with only the changed
 *   fields (the Server Tag pick saves on its own, `ServerTagField`). While there are unsaved
 *   changes the bar at the bottom offers Reset / Save, and leaving (another page, the other
 *   tab, closing the tab) is blocked and shakes the bar.
 * - Per-server Profiles: a Space picker and that Space's profile editor.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { Sparkles } from 'lucide-react';
import {
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  PRONOUNS_MAX_LENGTH,
  cosmeticName,
  type UserSelf,
} from '@enbox/shared';
import { useWornTag } from '@/components/cosmetics/TagPill/ServerTagPill';
import { IN_APP_NAV } from '@/components/layout/navigation';
import { Button, Input, Tabs, Textarea, toast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { AccountSection } from './AccountSection';
import { ColorPicker } from './ColorPicker';
import { CosmeticPickerModal, type PickerKind } from './CosmeticPickerModal';
import { draftCardUser, effectiveDisplayName } from './draft';
import { FormSection } from './FormSection';
import { AvatarField, BannerField } from './MediaFields';
import { NameStyleField } from './NameStyleField';
import { PerServerProfiles, SPACE_PROFILE_UNSAVED } from './PerServerProfiles';
import { PreviewPanel } from './ProfilePreview';
import { ServerTagField } from './ServerTagField';
import { UnsavedChangesBar, UnsavedChangesGuard } from './UnsavedChangesBar';
import { useProfileDraft, type ProfileDraftApi } from './useProfileDraft';

export { profileLink } from './AccountSection';

type Tab = 'main' | 'server';

const PRONOUN_SUGGESTIONS = [
  'she/her',
  'he/him',
  'they/them',
  'she/they',
  'he/they',
  'any pronouns',
];

const CHIP =
  'rounded-full px-3 py-1 text-[13px] transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export function ProfilePage() {
  const me = useMe();
  if (!me) return null;
  return <ProfilesEditor me={me} />;
}

function ProfilesEditor({ me }: { me: UserSelf }) {
  const d = useProfileDraft(me);
  const [tab, setTab] = useState<Tab>('main');
  const [shake, setShake] = useState(0);
  /** The per-Space editor (Per-server tab) has unsaved changes of its own. */
  const [serverDirty, setServerDirty] = useState(false);
  const blocked = () => {
    if (d.dirty) setShake((n) => n + 1);
    else toast.info(SPACE_PROFILE_UNSAVED);
  };

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    // Discord keeps you on the tab until the changes are saved or reset.
    if (d.dirty || serverDirty) return blocked();
    setTab(next);
  };

  return (
    <div
      className="@container min-h-0 flex-1 overflow-y-auto bg-surface scrollbar-thin"
      data-testid="profiles-editor"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-3 py-3 pb-[max(16px,env(safe-area-inset-bottom))] lg:px-6 lg:py-5">
        <Tabs
          value={tab}
          onChange={switchTab}
          variant="chips"
          aria-label="Profiles"
          idBase="profiles"
          items={[
            { value: 'main', label: 'Main Profile' },
            { value: 'server', label: 'Per-server Profiles' },
          ]}
        />
        {tab === 'main' ? (
          <div role="tabpanel" id="profiles-panel-main" aria-labelledby="profiles-tab-main">
            <MainProfile me={me} d={d} />
          </div>
        ) : (
          <div role="tabpanel" id="profiles-panel-server" aria-labelledby="profiles-tab-server">
            <PerServerProfiles onDirtyChange={setServerDirty} />
          </div>
        )}
        <UnsavedChangesBar
          open={d.dirty}
          saving={d.saving}
          onReset={d.reset}
          onSave={() => void d.save()}
          shakeKey={shake}
        />
      </div>
      <UnsavedChangesGuard when={d.dirty || serverDirty} onBlocked={blocked} />
    </div>
  );
}

function MainProfile({ me, d }: { me: UserSelf; d: ProfileDraftApi }) {
  const { draft, set } = d;
  const [picker, setPicker] = useState<PickerKind | null>(null);
  // The server tag saves on its own (ServerTagField); the preview shows the one I wear.
  const spaceTag = useWornTag(me.id);
  const user = { ...draftCardUser(me, draft), spaceTag };
  const pronouns = draft.pronouns.trim();
  const pickerValue =
    picker === 'decoration'
      ? draft.avatarDecoration
      : picker === 'effect'
        ? draft.profileEffect
        : draft.nameplate;

  return (
    <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] @3xl:gap-8">
      {/* First in the DOM so phones get the (collapsible) preview above the form. */}
      <aside className="min-w-0 @3xl:col-start-2 @3xl:row-start-1" aria-label="Preview">
        <div className="@3xl:sticky @3xl:top-0">
          <PreviewPanel user={user} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-7 @3xl:col-start-1 @3xl:row-start-1">
        <Link
          to="/collectibles"
          state={IN_APP_NAV}
          className="card-inset flex items-center gap-3 px-3.5 py-3 outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
          data-testid="collectibles-link"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-on-brand">
            <Sparkles size={18} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold text-fg">Collectibles</span>
            <span className="block text-[12.5px] text-muted">
              Decorations, effects, nameplates and name styles. Every item is free.
            </span>
          </span>
        </Link>

        <FormSection title="Display Name" hint="Leave it empty to use your username.">
          <Input
            aria-label="Display Name"
            value={draft.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            placeholder={me.username}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            autoComplete="name"
            data-testid="display-name-input"
          />
        </FormSection>

        <FormSection title="Pronouns">
          <Input
            aria-label="Pronouns"
            value={draft.pronouns}
            onChange={(e) => set('pronouns', e.target.value)}
            placeholder="Add your pronouns"
            maxLength={PRONOUNS_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="none"
            data-testid="pronouns-input"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pronoun suggestions">
            {PRONOUN_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={pronouns === s}
                onClick={() => set('pronouns', s)}
                className={cn(
                  CHIP,
                  pronouns === s
                    ? 'bg-brand-soft text-brand-ink'
                    : 'bg-surface-2 text-muted hover:bg-line hover:text-fg',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </FormSection>

        <AvatarField me={me} draft={draft} set={set} />

        <CosmeticField
          title="Avatar Decoration"
          current={cosmeticName('decoration', draft.avatarDecoration)}
          changeLabel="Change Decoration"
          onChange={() => setPicker('decoration')}
          onRemove={draft.avatarDecoration ? () => set('avatarDecoration', null) : undefined}
          testId="decoration-field"
        />
        <CosmeticField
          title="Profile Effect"
          current={cosmeticName('effect', draft.profileEffect)}
          changeLabel="Change Effect"
          onChange={() => setPicker('effect')}
          onRemove={draft.profileEffect ? () => set('profileEffect', null) : undefined}
          testId="effect-field"
        />
        <CosmeticField
          title="Nameplate"
          current={cosmeticName('nameplate', draft.nameplate)}
          changeLabel="Change Nameplate"
          onChange={() => setPicker('nameplate')}
          onRemove={draft.nameplate ? () => set('nameplate', null) : undefined}
          testId="nameplate-field"
        />

        <NameStyleField
          name={effectiveDisplayName(me, draft)}
          value={draft.nameStyle}
          onChange={(s) => set('nameStyle', s)}
        />

        <ServerTagField me={me} />

        <BannerField me={me} draft={draft} set={set} />

        <FormSection
          title="Profile Theme"
          hint="The primary colour fills your card's header when there is no banner; the accent completes the gradient."
          testId="theme-field"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorPicker
              label="Primary colour"
              value={draft.profileColor}
              onChange={(c) => set('profileColor', c)}
            />
            <ColorPicker
              label="Accent colour"
              value={draft.accentColor}
              fallback={draft.profileColor ?? '#6d5dfc'}
              onChange={(c) => set('accentColor', c)}
            />
          </div>
          {draft.profileColor || draft.accentColor ? (
            <div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  set('profileColor', null);
                  set('accentColor', null);
                }}
              >
                Reset theme
              </Button>
            </div>
          ) : null}
        </FormSection>

        <FormSection
          title="About Me"
          hint="Line breaks are kept. Who can see it follows your About privacy setting."
        >
          <Textarea
            aria-label="About Me"
            value={draft.bio}
            onChange={(e) => set('bio', e.target.value)}
            maxLength={BIO_MAX_LENGTH}
            autoResize
            rows={4}
            placeholder="Climber, coffee nerd, always up for a hike."
            aside={
              <span className="text-[12px] text-muted tabular-nums" data-testid="bio-counter">
                {draft.bio.length}/{BIO_MAX_LENGTH}
              </span>
            }
            data-testid="bio-input"
          />
        </FormSection>

        <AccountSection me={me} />
      </div>

      <CosmeticPickerModal
        kind={picker}
        value={pickerValue}
        user={user}
        onClose={() => setPicker(null)}
        onApply={(id) => {
          if (picker === 'decoration') set('avatarDecoration', id);
          else if (picker === 'effect') set('profileEffect', id);
          else if (picker === 'nameplate') set('nameplate', id);
        }}
      />
    </div>
  );
}

function CosmeticField({
  title,
  current,
  changeLabel,
  onChange,
  onRemove,
  testId,
}: {
  title: string;
  current: string | null;
  changeLabel: string;
  onChange: () => void;
  onRemove?: () => void;
  testId: string;
}) {
  return (
    <FormSection title={title} testId={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onChange}>
          {changeLabel}
        </Button>
        {onRemove ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
        <span className="text-[13px] text-muted" data-testid={`${testId}-current`}>
          {current ?? 'None'}
        </span>
      </div>
    </FormSection>
  );
}
