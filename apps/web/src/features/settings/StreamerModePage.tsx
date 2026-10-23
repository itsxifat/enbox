import { BellOff, EyeOff, Link2Off, MonitorUp, Radio, VolumeX } from 'lucide-react';
import type { IconType } from '@/components/ui';
import { useStreamer, type StreamerOption } from '@/stores/streamer';
import { SettingsGroup, SettingsScroller, SwitchRow } from './ui';

const OPTIONS: { key: StreamerOption; icon: IconType; title: string; description: string }[] = [
  {
    key: 'hidePersonal',
    icon: EyeOff,
    title: 'Hide Personal Information',
    description:
      'Hides your phone number, username and other private details in My Account, and your notes on profiles',
  },
  {
    key: 'hideInvites',
    icon: Link2Off,
    title: 'Hide Invite Links',
    description: 'Invite links and codes are hidden on screen; Copy and Share still work',
  },
  {
    key: 'disableSounds',
    icon: VolumeX,
    title: 'Disable Sounds',
    description: 'No notification or app sounds, ringtones included',
  },
  {
    key: 'disableNotifications',
    icon: BellOff,
    title: 'Disable Notifications',
    description: 'No desktop notifications',
  },
];

/**
 * App Settings ▸ Streamer Mode (Discord): hide personal information and invite links, and
 * silence sounds and desktop notifications while streaming. Device settings (stores/streamer.ts);
 * the options can be set up ahead and apply while the mode is on.
 */
export function StreamerModePage() {
  const s = useStreamer();
  return (
    <SettingsScroller>
      <SettingsGroup footer="Keeps your details and invite links off screen while you stream or share your screen. While it’s on, a bar on top of Enbox turns it off. Applies to this device only.">
        <SwitchRow
          icon={Radio}
          title="Enable Streamer Mode"
          description="Hides what you choose below and shows the Streamer Mode bar"
          checked={s.enabled}
          onChange={(v) => s.setEnabled(v)}
        />
        <SwitchRow
          icon={MonitorUp}
          title="Automatically turn on while sharing my screen"
          description="In voice channels and calls; it turns off again when you stop sharing"
          checked={s.autoOnScreenShare}
          onChange={(v) => s.setOption('autoOnScreenShare', v)}
        />
      </SettingsGroup>
      <SettingsGroup title="While Streamer Mode is on">
        {OPTIONS.map((o) => (
          <SwitchRow
            key={o.key}
            icon={o.icon}
            title={o.title}
            description={o.description}
            checked={s[o.key]}
            onChange={(v) => s.setOption(o.key, v)}
          />
        ))}
      </SettingsGroup>
    </SettingsScroller>
  );
}
