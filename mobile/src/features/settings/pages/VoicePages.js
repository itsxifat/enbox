import { AudioWaveform, Gauge, Speaker } from 'lucide-react-native';
import { useUi } from '@/stores/ui';
import { SettingsGroup, SettingsScroller, SwitchRow } from '../ui';

/** Settings → Voice and video: microphone processing for calls (device preferences). */
export function VoiceSettingsPage() {
  const prefs = useUi((s) => s.prefs);
  const set = useUi.getState().setPref;
  return (
    <SettingsScroller>
      <SettingsGroup
        title="Microphone"
        footer="These apply on this phone, right away — also during a call. AI voice isolation is in Enbox on the web."
      >
        <SwitchRow
          icon={AudioWaveform}
          title="Noise cancellation"
          description="Reduces background noise like fans, traffic and wind"
          checked={prefs.noiseCancellation}
          onChange={(v) => set('noiseCancellation', v)}
        />
        <SwitchRow
          icon={Speaker}
          title="Echo cancellation"
          description="Stops others hearing themselves through your speaker"
          checked={prefs.echoCancellation}
          onChange={(v) => set('echoCancellation', v)}
        />
        <SwitchRow
          icon={Gauge}
          title="Automatic gain control"
          description="Keeps your voice at a steady volume"
          checked={prefs.autoGainControl}
          onChange={(v) => set('autoGainControl', v)}
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}
