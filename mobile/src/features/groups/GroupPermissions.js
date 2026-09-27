/** Group permission switches (web GroupPermissions.tsx): creation flow and group settings. */
import { View } from 'react-native';
import { Switch } from '@/components/ui';
import { useTheme } from '@/theme';

export const PERMISSION_ROWS = [
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

export function GroupPermissionsFields({ value, onChange, disabled }) {
  const { tw } = useTheme();
  return (
    <View>
      {PERMISSION_ROWS.map((row, i) => (
        <View key={row.key} style={i ? tw`border-t border-line` : null}>
          <Switch
            label={row.label}
            description={row.description}
            checked={value[row.key]}
            onChange={(v) => onChange(row.key, v)}
            disabled={disabled}
          />
        </View>
      ))}
    </View>
  );
}
