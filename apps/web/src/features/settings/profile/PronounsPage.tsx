import { useState } from 'react';
import { PRONOUNS_MAX_LENGTH } from '@enbox/shared';
import { Button, Input, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { updateProfile } from '../settingsApi';
import { SettingsGroup, SettingsScroller } from '../ui';

const SUGGESTIONS = ['she/her', 'he/him', 'they/them', 'she/they', 'he/they', 'any pronouns'];

/** Settings → Profile → Pronouns: free text (≤ PRONOUNS_MAX_LENGTH) with the usual suggestions. */
export function PronounsPage() {
  const me = useMe();
  const [value, setValue] = useState(me?.pronouns ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const trimmed = value.trim();
  const dirty = trimmed !== (me.pronouns ?? '');

  const save = async (next: string) => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ pronouns: next || null });
      toast.success(next ? 'Pronouns updated' : 'Pronouns removed');
      setValue(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsScroller>
      <SettingsGroup
        title="Pronouns"
        footer="Shown next to your username on your profile card. Who can see them follows your About privacy setting."
      >
        <div className="flex flex-col gap-3 px-4 py-4 lg:px-5">
          <Input
            label="Your pronouns"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            maxLength={PRONOUNS_MAX_LENGTH}
            placeholder="they/them"
            autoComplete="off"
            autoCapitalize="none"
            error={error ?? undefined}
            data-testid="pronouns-input"
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Suggestions">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={trimmed === s}
                onClick={() => setValue(s)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[13.5px] transition-colors outline-none focus-visible:outline-2 focus-visible:outline-brand',
                  trimmed === s
                    ? 'border-brand bg-brand-soft text-brand-ink'
                    : 'border-line bg-surface-2 text-fg hover:bg-hover',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            {me.pronouns ? (
              <Button
                variant="ghost"
                className="mr-auto text-danger"
                onClick={() => void save('')}
                disabled={saving}
              >
                Remove
              </Button>
            ) : null}
            <Button onClick={() => void save(trimmed)} loading={saving} disabled={!dirty}>
              Save
            </Button>
          </div>
        </div>
      </SettingsGroup>
    </SettingsScroller>
  );
}
