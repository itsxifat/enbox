import type { ReactNode } from 'react';
import {
  DISAPPEARING_OPTIONS,
  formatTimer,
  type PrivacyLevel,
  type UserSettings,
} from '@enbox/shared';
import { RadioGroup, type RadioOption } from '@/components/ui';
import { useMe } from '@/stores/auth';
import { PRIVACY_LABELS, updateSettings } from '../settingsApi';
import { SettingsGroup, SettingsNote, SettingsScroller } from '../ui';

const LEVELS: PrivacyLevel[] = ['everyone', 'contacts', 'nobody'];
const levelOptions: RadioOption<PrivacyLevel>[] = LEVELS.map((v) => ({
  value: v,
  label: PRIVACY_LABELS[v],
}));

function RadioSection<T extends string>({
  title,
  value,
  options,
  onChange,
  footer,
}: {
  title: string;
  value: T;
  options: RadioOption<T>[];
  onChange: (v: T) => void;
  footer?: ReactNode;
}) {
  return (
    <SettingsGroup title={title} footer={footer}>
      <RadioGroup
        aria-label={title}
        value={value}
        onChange={onChange}
        options={options}
        className="px-4 py-1 lg:px-4"
      />
    </SettingsGroup>
  );
}

/** Settings → Privacy → Last seen and online. */
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

type LevelKey = 'profilePhotoVisibility' | 'aboutVisibility' | 'groupsAddPermission';

const LEVEL_PAGES: Record<LevelKey, { title: string; footer: string }> = {
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

/** Settings → Privacy → Profile photo / About / Groups. */
export function PrivacyLevelPage({ setting }: { setting: LevelKey }) {
  const me = useMe();
  if (!me) return null;
  const page = LEVEL_PAGES[setting];
  return (
    <SettingsScroller>
      <RadioSection
        title={page.title}
        value={me.settings[setting]}
        options={levelOptions}
        onChange={(v) => void updateSettings({ [setting]: v } as Partial<UserSettings>)}
        footer={page.footer}
      />
    </SettingsScroller>
  );
}

/** Settings → Privacy → Default message timer. */
export function DefaultTimerPage() {
  const me = useMe();
  if (!me) return null;
  const value = me.settings.defaultDisappearingSeconds;
  const options: RadioOption<string>[] = [
    ...DISAPPEARING_OPTIONS.map((sec) => ({ value: String(sec), label: formatTimer(sec) })),
    { value: 'off', label: 'Off' },
  ];
  return (
    <SettingsScroller>
      <SettingsNote className="pt-5 lg:pt-0">
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
