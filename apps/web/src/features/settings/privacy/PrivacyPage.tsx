import {
  CircleDashed,
  CircleUserRound,
  Clock,
  Eye,
  Info,
  PhoneOff,
  ShieldBan,
  Timer,
  UsersRound,
} from 'lucide-react';
import { useMe } from '@/stores/auth';
import { useBlockedUsers } from '@/stores/contacts';
import {
  PRIVACY_LABELS,
  lastSeenSummary,
  statusPrivacySummary,
  timerLabel,
  updateSettings,
} from '../settingsApi';
import { SettingsGroup, SettingsRow, SettingsScroller, SwitchRow } from '../ui';

/** Settings → Privacy. */
export function PrivacyPage() {
  const me = useMe();
  const { users: blocked, loaded } = useBlockedUsers();
  if (!me) return null;
  const s = me.settings;
  return (
    <SettingsScroller>
      <SettingsGroup
        title="Who can see my personal info"
        footer="If you don't share your last seen and online, you won't be able to see other people's either."
      >
        <SettingsRow
          icon={Clock}
          title="Last seen and online"
          description={lastSeenSummary(s)}
          to="/settings/privacy/last-seen"
          testId="privacy-last-seen"
        />
        <SettingsRow
          icon={CircleUserRound}
          title="Profile photo"
          description={PRIVACY_LABELS[s.profilePhotoVisibility]}
          to="/settings/privacy/profile-photo"
        />
        <SettingsRow
          icon={Info}
          title="About"
          description={PRIVACY_LABELS[s.aboutVisibility]}
          to="/settings/privacy/about"
        />
        <SettingsRow
          icon={CircleDashed}
          title="Status"
          description={statusPrivacySummary(s)}
          to="/settings/privacy/status"
        />
      </SettingsGroup>

      <SettingsGroup>
        <SwitchRow
          icon={Eye}
          title="Read receipts"
          description="If turned off, you won't send or receive read receipts in personal chats. Read receipts are always sent for group chats."
          checked={s.readReceipts}
          onChange={(v) => void updateSettings({ readReceipts: v })}
        />
      </SettingsGroup>

      <SettingsGroup title="Disappearing messages">
        <SettingsRow
          icon={Timer}
          title="Default message timer"
          description={`${timerLabel(s.defaultDisappearingSeconds)} · for new chats you start`}
          to="/settings/privacy/timer"
        />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          icon={UsersRound}
          title="Groups"
          description={`Who can add me: ${PRIVACY_LABELS[s.groupsAddPermission].toLowerCase()}`}
          to="/settings/privacy/groups"
        />
        <SwitchRow
          icon={PhoneOff}
          title="Silence unknown callers"
          description="Calls from people who aren't in your contacts won't ring. They still show in your call history."
          checked={s.silenceUnknownCallers}
          onChange={(v) => void updateSettings({ silenceUnknownCallers: v })}
        />
        <SettingsRow
          icon={ShieldBan}
          title="Blocked contacts"
          description={loaded ? (blocked.length ? `${blocked.length}` : 'None') : '…'}
          to="/settings/privacy/blocked"
          testId="privacy-blocked"
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}
