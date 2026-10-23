import { EyeOff } from 'lucide-react';
import { SettingsRow } from '@/features/settings/ui';
import { useIgnoredCount } from '@/stores/ignores';

/** Settings ▸ Privacy: the row that opens Ignored users, with how many there are. */
export function IgnoredUsersRow() {
  const { count, loaded } = useIgnoredCount();
  return (
    <SettingsRow
      icon={EyeOff}
      title="Ignored users"
      description={loaded ? (count ? `${count}` : 'None') : '…'}
      to="/settings/privacy/ignored"
      testId="privacy-ignored"
    />
  );
}
