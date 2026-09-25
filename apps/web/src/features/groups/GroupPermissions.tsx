/** Group permission switches (creation flow and the group settings page). */
import type { GroupSettings } from '@enbox/shared';
import { Switch } from '@/components/ui';

export const PERMISSION_ROWS: { key: keyof GroupSettings; label: string; description: string }[] = [
  {
    key: 'onlyAdminsCanSend',
    label: 'Only admins can send messages',
    description: 'Members can still read and react. Admins can also start calls.',
  },
  {
    key: 'onlyAdminsCanEditInfo',
    label: 'Only admins can edit group info',
    description: 'Name, icon, description, disappearing timer and pinned messages.',
  },
  {
    key: 'onlyAdminsCanAddMembers',
    label: 'Only admins can add members',
    description: 'Also hides the invite link from members.',
  },
];

export function GroupPermissionsFields({
  value,
  onChange,
  disabled,
}: {
  value: GroupSettings;
  onChange: (key: keyof GroupSettings, next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="divide-y divide-line">
      {PERMISSION_ROWS.map((row) => (
        <Switch
          key={row.key}
          label={row.label}
          description={row.description}
          checked={value[row.key]}
          onChange={(v) => onChange(row.key, v)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
