/**
 * Settings → Privacy and its sub-pages (web features/settings/privacy/*): last seen, profile
 * photo / about / groups levels, status privacy + contact lists, blocked contacts and the
 * default message timer.
 */
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CircleUserRound,
  Clock,
  Eye,
  Info,
  ShieldBan,
  Timer,
  UserRoundPlus,
  UsersRound,
} from 'lucide-react-native';
import { DISAPPEARING_OPTIONS, formatTimer, userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { Icon, PhoneOffIcon, UpdatesIcon } from '@/components/icons';
import {
  Button,
  EmptyState,
  ListItemSkeleton,
  Modal,
  Press,
  RadioGroup,
  Spinner,
  T,
} from '@/components/ui';
import { ContactPickerList } from '@/features/contacts/ContactPickerList';
import { confirmBlock, confirmUnblock } from '@/features/contacts/contactActions';
import { useMe } from '@/stores/auth';
import { useBlockedUsers } from '@/stores/contacts';
import { useTheme } from '@/theme';
import {
  PRIVACY_LABELS,
  lastSeenSummary,
  statusPrivacySummary,
  timerLabel,
  updateSettings,
} from '../settingsApi';
import { SettingsGroup, SettingsNote, SettingsRow, SettingsScroller, SwitchRow } from '../ui';

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
          icon={UpdatesIcon}
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
          icon={PhoneOffIcon}
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
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}

const LEVELS = ['everyone', 'contacts', 'nobody'];
const levelOptions = LEVELS.map((v) => ({ value: v, label: PRIVACY_LABELS[v] }));

function RadioSection({ title, value, options, onChange, footer }) {
  const { tw } = useTheme();
  return (
    <SettingsGroup title={title} footer={footer}>
      <RadioGroup value={value} onChange={onChange} options={options} style={tw`px-4 py-1`} />
    </SettingsGroup>
  );
}

export function LastSeenPage() {
  const me = useMe();
  if (!me) return null;
  const s = me.settings;
  return (
    <SettingsScroller>
      <RadioSection
        title="Who can see my last seen"
        value={s.lastSeenVisibility}
        options={levelOptions}
        onChange={(v) => void updateSettings({ lastSeenVisibility: v })}
      />
      <RadioSection
        title="Who can see when I'm online"
        value={s.onlineVisibility}
        options={[
          { value: 'everyone', label: 'Everyone' },
          { value: 'same_as_last_seen', label: 'Same as last seen' },
        ]}
        onChange={(v) => void updateSettings({ onlineVisibility: v })}
        footer="If you don't share when you were last seen or online, you won't be able to see when other people were last seen or online."
      />
    </SettingsScroller>
  );
}

const LEVEL_PAGES = {
  profilePhotoVisibility: {
    title: 'Who can see my profile photo',
    footer: 'People who can’t see your photo see your initials instead.',
  },
  aboutVisibility: {
    title: 'Who can see my about',
    footer: 'Your about is the short text under your name, like “Available”.',
  },
  groupsAddPermission: {
    title: 'Who can add me to groups',
    footer:
      'People who can’t add you directly can still send you an invite link to join. This also applies to communities.',
  },
};

export function PrivacyLevelPage({ setting }) {
  const me = useMe();
  if (!me) return null;
  const page = LEVEL_PAGES[setting];
  return (
    <SettingsScroller>
      <RadioSection
        title={page.title}
        value={me.settings[setting]}
        options={levelOptions}
        onChange={(v) => void updateSettings({ [setting]: v })}
        footer={page.footer}
      />
    </SettingsScroller>
  );
}

export function DefaultTimerPage() {
  const { tw } = useTheme();
  const me = useMe();
  if (!me) return null;
  const value = me.settings.defaultDisappearingSeconds;
  const options = [
    ...DISAPPEARING_OPTIONS.map((sec) => ({ value: String(sec), label: formatTimer(sec) })),
    { value: 'off', label: 'Off' },
  ];
  return (
    <SettingsScroller>
      <SettingsNote style={tw`pt-5`}>
        Start new one-on-one chats and groups you create with disappearing messages turned on. New
        messages disappear from the chat after the selected duration. Existing chats aren’t
        affected.
      </SettingsNote>
      <RadioSection
        title="Default message timer"
        value={value ? String(value) : 'off'}
        options={options}
        onChange={(v) =>
          void updateSettings({ defaultDisappearingSeconds: v === 'off' ? null : Number(v) })
        }
      />
    </SettingsScroller>
  );
}

export function StatusPrivacyPage() {
  const { tw } = useTheme();
  const me = useMe();
  const router = useRouter();
  if (!me) return null;
  const s = me.settings;
  const excluded = s.statusExcludeUserIds.length;
  const only = s.statusOnlyShareWithUserIds.length;

  const onChange = (v) => {
    void updateSettings({ statusPrivacy: v });
    if (v === 'contacts_except') router.push('/settings/privacy/status-except');
    if (v === 'only_share_with') router.push('/settings/privacy/status-only');
  };

  return (
    <SettingsScroller>
      <SettingsGroup
        title="Who can see my status updates"
        footer="Changes to your privacy settings won't affect status updates that you've sent already."
      >
        <RadioGroup
          value={s.statusPrivacy}
          onChange={onChange}
          style={tw`px-4 py-1`}
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
        <Press
          feedback={false}
          style={tw`self-start px-4`}
          onPress={() =>
            router.push(
              s.statusPrivacy === 'contacts_except'
                ? '/settings/privacy/status-except'
                : '/settings/privacy/status-only',
            )
          }
        >
          <T style={tw`text-[14px] font-semibold text-brand-ink`}>
            {s.statusPrivacy === 'contacts_except' ? 'Edit excluded contacts' : 'Edit shared list'}
          </T>
        </Press>
      ) : null}
    </SettingsScroller>
  );
}

export function StatusListPage({ list }) {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const router = useRouter();
  const key = list === 'exclude' ? 'statusExcludeUserIds' : 'statusOnlyShareWithUserIds';
  const initial = useMemo(() => new Set(me?.settings[key] ?? []), [me, key]);
  const [selected, setSelected] = useState(null);
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
    if (ok && router.canGoBack()) router.back();
  };

  return (
    <View style={tw`min-h-0 flex-1 bg-surface`}>
      <SettingsNote style={tw`px-4 pt-2`}>
        {list === 'exclude'
          ? 'Your status updates are shared with all your contacts except the ones you select.'
          : 'Your status updates are shared only with the contacts you select.'}
      </SettingsNote>
      <ScrollView style={tw`min-h-0 flex-1`} keyboardShouldPersistTaps="handled">
        <ContactPickerList
          selected={current}
          onToggle={(u, on) => {
            const next = new Set(current);
            if (on) next.add(u.id);
            else next.delete(u.id);
            setSelected(next);
          }}
        />
      </ScrollView>
      <View
        style={[
          tw`mx-3 mt-2 flex-row items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3`,
          { marginBottom: Math.max(12, insets.bottom) },
        ]}
      >
        <T style={tw`text-[14px] text-muted`}>
          {current.size} {list === 'exclude' ? 'excluded' : 'selected'}
        </T>
        <Button onPress={() => void save()} loading={saving} disabled={!dirty}>
          Done
        </Button>
      </View>
    </View>
  );
}

export function BlockedPage() {
  const { tw, c } = useTheme();
  const { users, loaded } = useBlockedUsers();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(null);
  const exclude = useMemo(() => new Set(users.map((u) => u.id)), [users]);

  const unblock = async (u) => {
    setBusy(u.id);
    await confirmUnblock(u);
    setBusy(null);
  };

  return (
    <SettingsScroller>
      <SettingsGroup
        title={loaded ? `Blocked (${users.length})` : 'Blocked'}
        footer="Blocked contacts can't call you or send you messages. Tap a contact to unblock them."
      >
        <Press
          onPress={() => setPicking(true)}
          style={tw`min-h-14 flex-row items-center gap-4 rounded-lg px-4 py-3`}
        >
          <View style={tw`size-10 items-center justify-center rounded-full bg-brand-soft`}>
            <Icon icon={UserRoundPlus} size={20} color={c['brand-ink']} />
          </View>
          <T style={tw`text-[16px] text-brand-ink`}>Block a contact</T>
        </Press>
        {!loaded ? (
          <ListItemSkeleton count={2} />
        ) : users.length === 0 ? (
          <EmptyState
            compact
            icon={ShieldBan}
            title="No blocked contacts"
            description="People you block will be listed here."
          />
        ) : (
          users.map((u) => (
            <Press
              key={u.id}
              onPress={() => void unblock(u)}
              disabled={busy === u.id}
              accessibilityLabel={`Unblock ${userDisplayName(u)}`}
              style={tw`flex-row items-center gap-3 rounded-lg px-4 py-2.5`}
            >
              <UserAvatar user={u} size="md" />
              <View style={tw`min-w-0 flex-1`}>
                <T numberOfLines={1} style={tw`text-[15.5px]`}>
                  {userDisplayName(u)}
                </T>
                <T numberOfLines={1} style={tw`text-[13px] text-muted`}>
                  @{u.username}
                </T>
              </View>
              {busy === u.id ? (
                <Spinner size={16} />
              ) : (
                <T style={tw`text-[13px] font-semibold text-brand-ink`}>Unblock</T>
              )}
            </Press>
          ))
        )}
      </SettingsGroup>
      <SettingsNote>You can also block someone from their contact info in a chat.</SettingsNote>

      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title="Block a contact"
        bodyStyle={tw`px-0 py-0`}
        footer={
          <Button variant="ghost" onPress={() => setPicking(false)}>
            Cancel
          </Button>
        }
      >
        <View style={tw`pb-3`}>
          <ContactPickerList
            mode="single"
            exclude={exclude}
            emptyText="Only saved contacts can be picked here."
            onToggle={(u) => {
              setPicking(false);
              void confirmBlock(u);
            }}
          />
        </View>
      </Modal>
    </SettingsScroller>
  );
}
