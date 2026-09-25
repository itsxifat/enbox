/**
 * PLACEHOLDER (agent 1 owns this file): /settings/:section. The "chats" section shows the
 * device preferences from the ui store (theme/enter-to-send) as a working example.
 */
import { useParams } from 'react-router';
import { Settings } from 'lucide-react';
import { Placeholder } from '@/components/common/Placeholder';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { RadioGroup, Switch } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useUi, type ThemePref } from '@/stores/ui';
import { SETTINGS_SECTIONS } from './sections';

function ChatsPrefs() {
  const theme = useUi((s) => s.theme);
  const enterToSend = useUi((s) => s.prefs.enterToSend);
  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <RadioGroup<ThemePref>
        label="Theme"
        value={theme}
        onChange={(t) => useUi.getState().setTheme(t)}
        options={[
          { value: 'system', label: 'System default' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
      <Switch
        label="Enter is send"
        description="Enter key will send your message"
        checked={enterToSend}
        onChange={(v) => useUi.getState().setPref('enterToSend', v)}
      />
    </div>
  );
}

export function SettingsSectionPage() {
  const { section } = useParams();
  const desktop = useIsDesktop();
  const def = SETTINGS_SECTIONS.find((s) => s.id === section);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <PaneHeader
        title={def?.title ?? 'Settings'}
        back={desktop ? undefined : '/settings'}
        border
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === 'chats' ? <ChatsPrefs /> : null}
        <Placeholder
          icon={def?.icon ?? Settings}
          title={def?.title ?? 'Unknown section'}
          description={def?.description}
          owner="agent 1"
        />
      </div>
    </div>
  );
}
