import { useEffect, useState } from 'react';
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
 * One colour: a hex text field (validated with the shared `hexColorSchema`, normalised to
 * lowercase), the native colour picker and the preset swatches. `null` = default.
 */
function ColourField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  testId: string;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const issue =
    text.trim() && !hexColorSchema.safeParse(text).success ? 'Use a #rrggbb colour' : null;
  return (
    <div className="flex flex-col gap-2.5">
      <Input
        label={label}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (!v.trim()) onChange(null);
          else {
            const r = hexColorSchema.safeParse(v);
            if (r.success) onChange(r.data);
          }
        }}
        placeholder="#6d5dfc"
        maxLength={7}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        error={issue ?? undefined}
        hint={value ? undefined : 'Default'}
        rightSlot={
          <input
            type="color"
            aria-label={`${label} picker`}
            value={value ?? '#6d5dfc'}
            onChange={(e) => {
              setText(e.target.value);
              onChange(e.target.value);
            }}
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
  const [profileColor, setProfileColor] = useState<string | null>(me?.profileColor ?? null);
  const [accentColor, setAccentColor] = useState<string | null>(me?.accentColor ?? null);
  const [saving, setSaving] = useState(false);
  if (!me) return null;
  const dirty = profileColor !== me.profileColor || accentColor !== me.accentColor;

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ profileColor, accentColor });
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
            user={{ ...selfCardUser(me), profileColor, accentColor }}
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
            value={profileColor}
            onChange={setProfileColor}
            testId="profile-color-input"
          />
          <ColourField
            label="Accent colour"
            value={accentColor}
            onChange={setAccentColor}
            testId="accent-color-input"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setProfileColor(null);
                setAccentColor(null);
              }}
              disabled={saving || (!profileColor && !accentColor)}
            >
              Use default
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
              Save
            </Button>
          </div>
        </div>
      </SettingsGroup>
    </SettingsScroller>
  );
}
