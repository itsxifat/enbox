import { useEffect, useState } from 'react';
import { Mic, MicOff, MonitorUp, PhoneOff, SwitchCamera, Volume2 } from 'lucide-react';
import { VideoIcon, VideoOffIcon } from '@/components/icons';
import { DropdownMenu } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useCalls, type ActiveCall } from '@/stores/calls';
import { listDevices, outputSelectionSupported, screenShareSupported } from '../engine/media';
import { CallButton } from './CallButton';

function useOutputDevices(enabled: boolean): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      void listDevices('audiooutput').then((d) => {
        if (alive) setDevices(d.filter((x) => x.deviceId));
      });
    load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', load);
    };
  }, [enabled]);
  return devices;
}

/** Bottom controls bar of the call screen. */
export function CallControls({ active }: { active: ActiveCall }) {
  const desktop = useIsDesktop();
  const calls = useCalls.getState;
  const outputs = useOutputDevices(outputSelectionSupported());
  const canShare = desktop && screenShareSupported();
  const connectedish = active.phase !== 'starting' && !!active.call.id;
  const camOn = !active.videoOff;

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center bg-gradient-to-t from-black/60 via-black/25 to-transparent px-3 pt-10 pb-[max(20px,env(safe-area-inset-bottom))]">
      <div
        role="toolbar"
        aria-label="Call controls"
        className="flex max-w-full items-center gap-2.5 overflow-x-auto rounded-full bg-black/35 px-3 py-2.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl scrollbar-none sm:gap-3 sm:px-4"
      >
        {camOn && (active.canFlip || !desktop) && !active.screenSharing ? (
          <CallButton
            icon={SwitchCamera}
            label="Switch camera"
            size={desktop ? 'md' : 'lg'}
            onClick={() => calls().flipCamera()}
          />
        ) : null}
        <CallButton
          icon={camOn ? VideoIcon : VideoOffIcon}
          label={camOn ? 'Turn camera off' : 'Turn camera on'}
          tone={camOn ? 'light' : 'glass'}
          pressed={camOn}
          size={desktop ? 'md' : 'lg'}
          onClick={() => calls().toggleVideo()}
        />
        <CallButton
          icon={active.audioMuted ? MicOff : Mic}
          label={active.audioMuted ? 'Unmute' : 'Mute'}
          tone={active.audioMuted ? 'light' : 'glass'}
          pressed={active.audioMuted}
          size={desktop ? 'md' : 'lg'}
          onClick={() => calls().toggleMute()}
        />
        {outputs.length > 1 ? (
          <DropdownMenu
            align="start"
            aria-label="Audio output"
            trigger={(t) => (
              <CallButton
                ref={t.ref}
                onClick={t.onClick}
                aria-haspopup="menu"
                aria-expanded={t.active}
                icon={Volume2}
                label="Audio output"
                size={desktop ? 'md' : 'lg'}
              />
            )}
            items={outputs.map((d, i) => ({
              label: d.label || (i === 0 ? 'Default speaker' : `Speaker ${i + 1}`),
              hint: (active.outputDeviceId ?? 'default') === d.deviceId ? '✓' : undefined,
              onSelect: () => calls().setOutputDevice(d.deviceId),
            }))}
          />
        ) : null}
        {canShare ? (
          <CallButton
            icon={MonitorUp}
            label={active.screenSharing ? 'Stop presenting' : 'Share screen'}
            tone={active.screenSharing ? 'light' : 'glass'}
            pressed={active.screenSharing}
            size="md"
            disabled={!connectedish}
            onClick={() => calls().toggleScreenShare()}
          />
        ) : null}
        <CallButton
          icon={PhoneOff}
          label={active.outgoing && !active.connectedAt ? 'Cancel call' : 'End call'}
          tone="danger"
          size={desktop ? 'md' : 'lg'}
          wide
          onClick={() => calls().leaveCall()}
        />
      </div>
    </div>
  );
}
