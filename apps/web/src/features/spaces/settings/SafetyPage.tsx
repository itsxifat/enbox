import { useState } from 'react';
import { SPACE_VERIFICATION_LEVELS, type Space } from '@enbox/shared';
import { Button, RadioGroup, toast } from '@/components/ui';
import { updateSpace } from '../actions';

/** What Enbox can check of each verification level (the server enforces Medium and High). */
const ENFORCEMENT: Record<number, string | undefined> = {
  1: 'Not checked yet: Enbox accounts have no email address. Saved for later.',
  4: 'Medium and High apply. The phone check is not enforced yet: Enbox does not verify phone numbers.',
};

const EXPLICIT_FILTER = [
  { value: '0', label: 'Don’t scan any media content' },
  { value: '1', label: 'Scan media content from members without a role' },
  { value: '2', label: 'Scan media content from all members' },
] as const;

/**
 * Space Settings → Safety Setup (MANAGE_SPACE): Discord's verification level and explicit
 * media content filter. Members with a role, the owner and administrators are exempt from
 * the verification level.
 */
export function SafetyPage({ space }: { space: Space }) {
  const [level, setLevel] = useState(space.verificationLevel);
  const [filter, setFilter] = useState(space.explicitFilter);
  const [busy, setBusy] = useState(false);
  const dirty = level !== space.verificationLevel || filter !== space.explicitFilter;
  const save = async () => {
    setBusy(true);
    try {
      await updateSpace(space.id, {
        ...(level !== space.verificationLevel ? { verificationLevel: level } : {}),
        ...(filter !== space.explicitFilter ? { explicitFilter: filter } : {}),
      });
      toast.success('Changes saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h3 className="text-[12px] font-bold tracking-wide text-muted uppercase">Verification level</h3>
        <p className="text-[13px] text-muted">
          Members must meet these requirements before they can send messages in this Space’s channels. Members with a role are exempt.
        </p>
        <RadioGroup
          name="sp-verification"
          aria-label="Verification level"
          value={String(level)}
          onChange={(v) => setLevel(Number(v))}
          options={SPACE_VERIFICATION_LEVELS.map((l) => ({
            value: String(l.level),
            label: l.label,
            description: ENFORCEMENT[l.level] ? `${l.description}. ${ENFORCEMENT[l.level]}` : l.description,
          }))}
        />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[12px] font-bold tracking-wide text-muted uppercase">Explicit media content filter</h3>
        <p className="text-[13px] text-muted">
          Saved, not enforced yet: Enbox does not scan images and videos. Your choice applies once scanning arrives.
        </p>
        <RadioGroup
          name="sp-explicit-filter"
          aria-label="Explicit media content filter"
          value={String(filter)}
          onChange={(v) => setFilter(Number(v))}
          options={EXPLICIT_FILTER.map((o) => ({ value: o.value, label: o.label }))}
        />
      </section>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={!dirty}
          onClick={() => {
            setLevel(space.verificationLevel);
            setFilter(space.explicitFilter);
          }}
        >
          Reset
        </Button>
        <Button disabled={!dirty} loading={busy} onClick={() => void save()}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
