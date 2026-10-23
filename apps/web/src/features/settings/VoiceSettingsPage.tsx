import { useEffect } from 'react';
import {
  AudioLines,
  AudioWaveform,
  Camera,
  Gauge,
  Keyboard,
  Mic,
  Speaker,
  Timer,
  Volume2,
} from 'lucide-react';
import { outputSelectionSupported } from '@/features/calls/engine/media';
import { voiceIsolationAvailable } from '@/features/calls/voice';
import { SoundboardVolumeSetting } from '@/features/soundboard/SoundboardVolumeSetting';
import { stopMicTest } from '@/features/voice/micTest';
import {
  DeviceRow,
  MicTestRow,
  RangeRow,
  SensitivitySlider,
} from '@/features/voice/settings/controls';
import { ShortcutRecorder } from '@/features/voice/settings/ShortcutRecorder';
import { StreamQualityRow } from '@/features/voice/stream/StreamQualityRow';
import { VOLUME_MAX } from '@/features/voice/userAudio';
import { RadioGroup } from '@/components/ui';
import { useUi, type VoiceInputMode } from '@/stores/ui';
import { SettingsGroup, SettingsScroller, SwitchRow } from './ui';

/** The push to talk release delay goes up to two seconds. */
const PTT_RELEASE_MAX_MS = 2_000;

const INPUT_MODES: { value: VoiceInputMode; label: string; description: string }[] = [
  {
    value: 'voiceActivity',
    label: 'Voice Activity',
    description: 'Your mic turns on when you talk',
  },
  {
    value: 'pushToTalk',
    label: 'Push to Talk',
    description: 'Your mic is on only while you hold a shortcut',
  },
];

/**
 * Settings → Voice & Video (device preferences, all applied at once — also in a call or voice
 * channel): devices and output volume, the mic test, the input mode (voice activity with an
 * automatic or manual sensitivity, or push to talk with its shortcut and release delay), the
 * camera, the screen share quality (stream/quality.ts), microphone processing and the
 * soundboard volume.
 */
export function VoiceSettingsPage() {
  const prefs = useUi((s) => s.prefs);
  const set = useUi.getState().setPref;
  const isolation = voiceIsolationAvailable();
  const ptt = prefs.voiceInputMode === 'pushToTalk';
  // Leaving the page ends the mic test.
  useEffect(() => () => stopMicTest(), []);
  return (
    <SettingsScroller>
      <SettingsGroup title="Voice settings">
        <DeviceRow
          kind="audioinput"
          icon={Mic}
          title="Input device"
          value={prefs.audioInputDevice}
          onChange={(id) => set('audioInputDevice', id)}
          testId="input-device"
        />
        {outputSelectionSupported() ? (
          <DeviceRow
            kind="audiooutput"
            icon={Speaker}
            title="Output device"
            value={prefs.audioOutputDevice}
            onChange={(id) => set('audioOutputDevice', id)}
            testId="output-device"
          />
        ) : null}
        <RangeRow
          icon={Volume2}
          title="Output volume"
          min={0}
          max={VOLUME_MAX * 100}
          value={Math.round(prefs.outputVolume * 100)}
          format={(v) => `${v}%`}
          onChange={(v) => set('outputVolume', v / 100)}
          testId="output-volume"
        />
      </SettingsGroup>

      <SettingsGroup title="Mic test">
        <MicTestRow />
      </SettingsGroup>

      <SettingsGroup
        title="Input mode"
        footer={
          ptt
            ? 'Push to talk works while Enbox is focused.'
            : prefs.inputSensitivityAuto
              ? undefined
              : 'Your mic sends only while your voice is above the line.'
        }
      >
        <div className="px-3 py-1 lg:px-4">
          <RadioGroup
            aria-label="Input mode"
            value={prefs.voiceInputMode}
            onChange={(v) => set('voiceInputMode', v)}
            options={INPUT_MODES}
          />
        </div>
        {ptt ? (
          <>
            <div className="flex items-start gap-4 rounded-lg px-3 py-2.5 lg:px-4">
              <Keyboard size={22} className="mt-2 shrink-0 text-muted" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-[16px] leading-snug text-fg">Shortcut</span>
                <ShortcutRecorder
                  value={prefs.pttShortcut}
                  onChange={(c) => set('pttShortcut', c)}
                />
                {prefs.pttShortcut ? null : (
                  <span className="text-[13.5px] text-warning">Record a shortcut to talk.</span>
                )}
              </div>
            </div>
            <RangeRow
              icon={Timer}
              title="Push to talk release delay"
              description="How long your mic stays on after you let go"
              min={0}
              max={PTT_RELEASE_MAX_MS}
              step={10}
              value={prefs.pttReleaseDelayMs}
              format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`)}
              onChange={(v) => set('pttReleaseDelayMs', v)}
              testId="ptt-release-delay"
            />
          </>
        ) : (
          <>
            <SwitchRow
              icon={Gauge}
              title="Automatically determine input sensitivity"
              checked={prefs.inputSensitivityAuto}
              onChange={(v) => set('inputSensitivityAuto', v)}
            />
            {prefs.inputSensitivityAuto ? null : (
              <SensitivitySlider
                value={prefs.inputSensitivityDb}
                onChange={(db) => set('inputSensitivityDb', db)}
              />
            )}
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title="Video settings">
        <DeviceRow
          kind="videoinput"
          icon={Camera}
          title="Camera"
          value={prefs.videoInputDevice}
          onChange={(id) => set('videoInputDevice', id)}
          testId="camera-device"
        />
      </SettingsGroup>

      <SettingsGroup
        title="Screen share"
        footer="Applies the next time you share your screen. Higher quality needs a faster connection."
      >
        <StreamQualityRow />
      </SettingsGroup>

      <SettingsGroup
        title="Voice processing"
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

      <SettingsGroup
        title="Soundboard"
        footer="Sounds people play in your voice channel, on this device."
      >
        <SoundboardVolumeSetting />
      </SettingsGroup>
    </SettingsScroller>
  );
}
