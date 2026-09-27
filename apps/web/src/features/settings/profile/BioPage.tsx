import { useState } from 'react';
import { BIO_MAX_LENGTH } from '@enbox/shared';
import { Button, Textarea, toast } from '@/components/ui';
import { selfCardUser } from '@/features/profile/model';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { errorMessage } from '@/lib/api';
import { useMe } from '@/stores/auth';
import { updateProfile } from '../settingsApi';
import { SettingsGroup, SettingsScroller } from '../ui';

/** Settings → Profile → Bio: the multi-line "About me" of the profile card (≤ BIO_MAX_LENGTH). */
export function BioPage() {
  const me = useMe();
  const [value, setValue] = useState(me?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const trimmed = value.trim();
  const dirty = trimmed !== me.bio;
  const remaining = Math.max(0, BIO_MAX_LENGTH - Array.from(value).length);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ bio: trimmed });
      toast.success(trimmed ? 'Bio updated' : 'Bio removed');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScroller>
      <SettingsGroup
        title="About me"
        footer={`Up to ${BIO_MAX_LENGTH} characters; line breaks are kept. Who can see it follows your About privacy setting.`}
      >
        <div className="flex flex-col gap-3 px-4 py-4 lg:px-5">
          <Textarea
            aria-label="Bio"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            maxLength={BIO_MAX_LENGTH}
            autoResize
            rows={4}
            placeholder="Climber, coffee nerd, always up for a hike."
            error={error ?? undefined}
            hint={`${remaining} characters left`}
            data-testid="bio-input"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setValue(me.bio)} disabled={!dirty || saving}>
              Reset
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
              Save
            </Button>
          </div>
        </div>
      </SettingsGroup>
      <SettingsGroup title="Preview">
        <div className="p-4 lg:p-5">
          <ProfileCard
            user={{ ...selfCardUser(me), bio: trimmed || null }}
            self
            preview
            className="rounded-2xl border border-line"
          />
        </div>
      </SettingsGroup>
    </SettingsScroller>
  );
}
