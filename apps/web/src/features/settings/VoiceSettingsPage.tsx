import { AudioLines, AudioWaveform, Gauge, Speaker } from 'lucide-react';
import { voiceIsolationAvailable } from '@/features/calls/voice';
import { useUi } from '@/stores/ui';
import { SettingsGroup, SettingsScroller, SwitchRow } from './ui';

/** Settings → Voice and video: microphone processing for calls (device preferences). */
export function VoiceSettingsPage() {
  const prefs = useUi((s) => s.prefs);
  const set = useUi.getState().setPref;
  const isolation = voiceIsolationAvailable();
  return (
    <SettingsScroller>
      <SettingsGroup
        title="Microphone"
        footer="These apply on this device, right away — also during a call."
      >
        <SwitchRow
          icon={AudioLines}
          title="Voice isolation"
          description={
            isolation
              ? 'An AI filter keeps your voice and removes background sounds like typing, traffic and music'
              : 'Not available in this browser'
          }
          checked={isolation && prefs.voiceIsolation}
          disabled={!isolation}
          onChange={(v) => set('voiceIsolation', v)}
        />
        <SwitchRow
          icon={AudioWaveform}
          title="Noise cancellation"
          description="Reduces steady background noise like fans, hum and wind"
          checked={prefs.noiseCancellation}
          onChange={(v) => set('noiseCancellation', v)}
        />
        <SwitchRow
          icon={Speaker}
          title="Echo cancellation"
          description="Stops others hearing themselves through your speakers"
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
