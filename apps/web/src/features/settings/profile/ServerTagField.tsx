/**
 * Settings ▸ Profiles ▸ Server Tag: wear the tag of one of my Spaces next to my name
 * everywhere, or none. A pick saves at once (`PUT /api/me/space-tag`), apart from the profile
 * draft; leaving that Space, or the Space removing its tag, takes it off.
 */
import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { ID, UserSelf } from '@enbox/shared';
import { useWornTag } from '@/components/cosmetics/TagPill/ServerTagPill';
import { TagPill } from '@/components/cosmetics/TagPill/TagPill';
import { toast } from '@/components/ui';
import { wearSpaceTag } from '@/features/spaceTags/actions';
import { cn } from '@/lib/cn';
import { useSpaceList } from '@/stores/spaces';
import { FormSection } from './FormSection';

export function ServerTagField({ me }: { me: UserSelf }) {
  const tagged = useSpaceList().filter((s) => !!s.tag);
  const worn = useWornTag(me.id);
  const current = worn?.spaceId ?? null;
  const [busy, setBusy] = useState(false);

  const pick = async (spaceId: ID | null) => {
    if (busy || spaceId === current) return;
    setBusy(true);
    try {
      await wearSpaceTag(spaceId);
      toast.success(spaceId ? 'Tag updated' : 'Tag taken off');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSection
      title="Server Tag"
      hint="Show the tag of one of your Spaces next to your name, everywhere. It changes right away; leaving the Space takes it off."
      testId="server-tag-field"
    >
      {tagged.length === 0 ? (
        <p className="text-[13px] text-muted">None of your Spaces has a tag yet.</p>
      ) : (
        <div role="radiogroup" aria-label="Server Tag" className="card-inset flex flex-col p-1">
          <TagOption checked={current === null} disabled={busy} onSelect={() => void pick(null)}>
            <span className="text-[14.5px] text-fg">None</span>
          </TagOption>
          {tagged.map((s) => (
            <TagOption
              key={s.id}
              checked={current === s.id}
              disabled={busy}
              onSelect={() => void pick(s.id)}
            >
              <TagPill tag={s.tag!} size="md" />
              <span className="min-w-0 truncate text-[14.5px] text-fg">{s.name}</span>
            </TagOption>
          ))}
        </div>
      )}
    </FormSection>
  );
}

function TagOption({
  checked,
  disabled,
  onSelect,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60',
        checked ? 'bg-selected' : 'hover:bg-hover',
      )}
    >
      {children}
      <span className="flex-1" aria-hidden />
      {checked ? <Check size={18} className="shrink-0 text-brand-ink" aria-hidden /> : null}
    </button>
  );
}
