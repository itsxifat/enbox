import { useState } from 'react';
import { hexColorSchema } from '@enbox/shared';
import { Button, Input, toast } from '@/components/ui';
import { selfCardUser } from '@/features/profile/model';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { updateProfile } from '../settingsApi';
import { SettingsGroup, SettingsScroller } from '../ui';

/** The avatar fallback palette: known-good choices with white text. */
const PRESETS = [
  '#6d5dfc',
  '#0e7fc0',
  '#0f8a6a',
  '#c2410c',
  '#be185d',
  '#7c3aed',
  '#0f766e',
  '#b45309',
];

/**
 * What a colour field's text means: `null` for an empty field (the default), the lowercase
 * hex of a valid one (shared `hexColorSchema`), or an issue — the page keeps the text, so it
 * always knows whether what the field shows can be saved.
 */
function parseColour(text: string): { value: string | null; issue: string | null } {
  if (!text.trim()) return { value: null, issue: null };
  const r = hexColorSchema.safeParse(text);
  return r.success
    ? { value: r.data, issue: null }
    : { value: null, issue: 'Use a #rrggbb colour' };
}

/** Typed text as kept: a valid colour normalised to lowercase, anything else as it is. */
function normaliseColour(text: string): string {
  return parseColour(text).value ?? text;
}

/** One colour: a hex text field, the native colour picker and the preset swatches. */
function ColourField({
  label,
  text,
  onChange,
  testId,
}: {
  label: string;
  text: string;
  onChange: (text: string) => void;
  testId: string;
}) {
  const { value, issue } = parseColour(text);
  return (
    <div className="flex flex-col gap-2.5">
      <Input
        label={label}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#6d5dfc"
        maxLength={7}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        error={issue ?? undefined}
        hint={text ? undefined : 'Default'}
        rightSlot={
          <input
            type="color"
            aria-label={`${label} picker`}
            value={value ?? '#6d5dfc'}
            onChange={(e) => onChange(e.target.value)}
            className="size-8 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
          />
        }
        data-testid={testId}
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label={`${label} presets`}>
        {PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={value === c}
            onClick={() => onChange(c)}
            className={cn(
              'size-7 rounded-full ring-offset-2 ring-offset-surface outline-none focus-visible:ring-2 focus-visible:ring-brand',
              value === c && 'ring-2 ring-brand',
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Settings → Profile → Profile colours: the card header gradient (profile colour → accent
 * colour) with a live preview; `PATCH /api/me { profileColor, accentColor }`.
 */
export function ColoursPage() {
  const me = useMe();
  const [profileText, setProfileText] = useState(me?.profileColor ?? '');
  const [accentText, setAccentText] = useState(me?.accentColor ?? '');
  const [saving, setSaving] = useState(false);
  if (!me) return null;
  const profile = parseColour(profileText);
  const accent = parseColour(accentText);
  // A field showing an invalid colour blocks Save: what it shows is what would be saved.
  const invalid = !!(profile.issue || accent.issue);
  const dirty = profile.value !== me.profileColor || accent.value !== me.accentColor;

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ profileColor: profile.value, accentColor: accent.value });
      toast.success('Colours updated');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScroller>
      <SettingsGroup title="Preview">
        <div className="p-4 lg:p-5">
          <ProfileCard
            user={{ ...selfCardUser(me), profileColor: profile.value, accentColor: accent.value }}
            self
            preview
            className="rounded-2xl border border-line"
          />
        </div>
      </SettingsGroup>
      <SettingsGroup
        title="Colours"
        footer="The profile colour fills the top of your card when you have no banner; the accent colour completes the gradient and underlines a banner. Who can see them follows your About privacy setting."
      >
        <div className="flex flex-col gap-5 px-4 py-4 lg:px-5">
          <ColourField
            label="Profile colour"
            text={profileText}
            onChange={(t) => setProfileText(normaliseColour(t))}
            testId="profile-color-input"
          />
          <ColourField
            label="Accent colour"
            text={accentText}
            onChange={(t) => setAccentText(normaliseColour(t))}
            testId="accent-color-input"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setProfileText('');
                setAccentText('');
              }}
              disabled={saving || (!profileText && !accentText)}
            >
              Use default
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={!dirty || invalid}>
              Save
            </Button>
          </div>
        </div>
      </SettingsGroup>
    </SettingsScroller>
  );
}
