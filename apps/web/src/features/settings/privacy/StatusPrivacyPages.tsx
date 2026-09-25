import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ID, StatusPrivacy } from '@enbox/shared';
import { Button, RadioGroup } from '@/components/ui';
import { ContactPickerList } from '@/features/contacts/ContactPickerList';
import { useMe } from '@/stores/auth';
import { updateSettings } from '../settingsApi';
import { SettingsGroup, SettingsNote, SettingsScroller } from '../ui';

/** Settings → Privacy → Status: who sees my status updates. */
export function StatusPrivacyPage() {
  const me = useMe();
  const navigate = useNavigate();
  if (!me) return null;
  const s = me.settings;
  const excluded = s.statusExcludeUserIds.length;
  const only = s.statusOnlyShareWithUserIds.length;

  const onChange = (v: StatusPrivacy) => {
    void updateSettings({ statusPrivacy: v });
    if (v === 'contacts_except') void navigate('/settings/privacy/status-except');
    if (v === 'only_share_with') void navigate('/settings/privacy/status-only');
  };

  return (
    <SettingsScroller>
      <SettingsGroup
        title="Who can see my status updates"
        footer="Changes to your privacy settings won't affect status updates that you've sent already."
      >
        <RadioGroup<StatusPrivacy>
          aria-label="Who can see my status updates"
          value={s.statusPrivacy}
          onChange={onChange}
          className="px-4 py-1"
          options={[
            { value: 'contacts', label: 'My contacts' },
            {
              value: 'contacts_except',
              label: 'My contacts except…',
              description: excluded ? `${excluded} excluded` : undefined,
            },
            {
              value: 'only_share_with',
              label: 'Only share with…',
              description: `${only} included`,
            },
          ]}
        />
      </SettingsGroup>
      {s.statusPrivacy !== 'contacts' ? (
        <div className="px-4 lg:px-0">
          <Link
            to={
              s.statusPrivacy === 'contacts_except'
                ? '/settings/privacy/status-except'
                : '/settings/privacy/status-only'
            }
            className="text-[14px] font-semibold text-brand-ink hover:underline"
          >
            {s.statusPrivacy === 'contacts_except' ? 'Edit excluded contacts' : 'Edit shared list'}
          </Link>
        </div>
      ) : null}
    </SettingsScroller>
  );
}

/** Contact picker for `statusExcludeUserIds` / `statusOnlyShareWithUserIds`. */
export function StatusListPage({ list }: { list: 'exclude' | 'only' }) {
  const me = useMe();
  const navigate = useNavigate();
  const key = list === 'exclude' ? 'statusExcludeUserIds' : 'statusOnlyShareWithUserIds';
  const initial = useMemo(() => new Set<ID>(me?.settings[key] ?? []), [me, key]);
  const [selected, setSelected] = useState<Set<ID> | null>(null);
  const [saving, setSaving] = useState(false);
  if (!me) return null;
  const current = selected ?? initial;
  const dirty =
    selected !== null &&
    (selected.size !== initial.size || [...selected].some((id) => !initial.has(id)));

  const save = async () => {
    setSaving(true);
    const ok = await updateSettings({
      [key]: [...current],
      statusPrivacy: list === 'exclude' ? 'contacts_except' : 'only_share_with',
    });
    setSaving(false);
    if (ok) void navigate('/settings/privacy/status');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <SettingsNote className="lg:px-4">
        {list === 'exclude'
          ? 'Your status updates are shared with all your contacts except the ones you select.'
          : 'Your status updates are shared only with the contacts you select.'}
      </SettingsNote>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <ContactPickerList
          selected={current}
          onToggle={(u, on) => {
            const next = new Set(current);
            if (on) next.add(u.id);
            else next.delete(u.id);
            setSelected(next);
          }}
        />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <span className="text-[14px] text-muted">
          {current.size} {list === 'exclude' ? 'excluded' : 'selected'}
        </span>
        <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
          Done
        </Button>
      </div>
    </div>
  );
}
