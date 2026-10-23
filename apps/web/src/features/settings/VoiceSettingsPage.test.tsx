/**
 * Settings → Voice & Video writes the device prefs: input, output (only where the browser can
 * pick one) and camera devices, the output volume, the input mode with push to talk's shortcut
 * and release delay, the automatic or manual input sensitivity, and the processing switches;
 * "Let's Check" starts the mic test and leaving the page stops it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type * as MicTestModule from '@/features/voice/micTest';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';

const micTest = vi.hoisted(() => ({
  startMicTest: vi.fn(async () => undefined),
  stopMicTest: vi.fn(),
}));
vi.mock('@/features/voice/micTest', async (importOriginal) => ({
  ...(await importOriginal<typeof MicTestModule>()),
  ...micTest,
}));

const { VoiceSettingsPage } = await import('./VoiceSettingsPage');

const device = (kind: MediaDeviceKind, deviceId: string, label: string) =>
  ({ kind, deviceId, label, groupId: 'g' }) as MediaDeviceInfo;

const DEVICES = [
  device('audioinput', 'default', 'Default - Desk Mic'),
  device('audioinput', 'mic-1', 'Desk Mic'),
  device('audioinput', 'mic-2', 'Headset Mic'),
  device('audiooutput', 'spk-1', 'Speakers'),
  device('audiooutput', 'spk-2', 'Headphones'),
  device('videoinput', 'cam-1', 'Webcam'),
];

const prefs = () => useUi.getState().prefs;

describe('VoiceSettingsPage', () => {
  beforeEach(() => {
    useUi.setState({ prefs: DEFAULT_PREFS });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn(async () => DEVICES),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    // The browser can pick the speaker.
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
  });
  afterEach(() => {
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    micTest.startMicTest.mockClear();
    micTest.stopMicTest.mockClear();
  });

  it('devices: Default first, then each device; choosing one keeps it', async () => {
    render(<VoiceSettingsPage />);
    const input = await screen.findByTestId('input-device');
    await within(input).findByRole('option', { name: 'Headset Mic' });
    expect(
      within(input)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Default (Desk Mic)', 'Desk Mic', 'Headset Mic']);
    fireEvent.change(input, { target: { value: 'mic-2' } });
    expect(prefs().audioInputDevice).toBe('mic-2');

    const output = screen.getByTestId('output-device');
    await within(output).findByRole('option', { name: 'Headphones' });
    fireEvent.change(output, { target: { value: 'spk-2' } });
    expect(prefs().audioOutputDevice).toBe('spk-2');

    const camera = screen.getByTestId('camera-device');
    await within(camera).findByRole('option', { name: 'Webcam' });
    fireEvent.change(camera, { target: { value: 'cam-1' } });
    expect(prefs().videoInputDevice).toBe('cam-1');

    fireEvent.change(input, { target: { value: '' } });
    expect(prefs().audioInputDevice).toBe('');
  });

  it('no speaker choice where the browser cannot pick one', () => {
    delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    render(<VoiceSettingsPage />);
    expect(screen.queryByTestId('output-device')).toBeNull();
    expect(screen.getByTestId('input-device')).toBeInTheDocument();
  });

  it('output volume goes to 200%', () => {
    render(<VoiceSettingsPage />);
    const slider = screen.getByTestId('output-volume');
    expect(slider).toHaveAttribute('max', '200');
    fireEvent.change(slider, { target: { value: '150' } });
    expect(prefs().outputVolume).toBe(1.5);
    expect(slider).toHaveAttribute('aria-valuetext', '150%');
  });

  it('push to talk: the shortcut recorder, the release delay and the focus note', () => {
    render(<VoiceSettingsPage />);
    expect(screen.queryByTestId('ptt-shortcut')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Push to Talk/ }));
    expect(prefs().voiceInputMode).toBe('pushToTalk');
    expect(screen.getByTestId('ptt-shortcut')).toHaveTextContent('No shortcut');
    expect(screen.getByText('Record a shortcut to talk.')).toBeInTheDocument();
    expect(screen.getByText(/works while Enbox is focused/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Record Keybind' }));
    fireEvent.keyDown(document.body, { code: 'KeyT', key: 't', altKey: true });
    expect(prefs().pttShortcut).toEqual({
      code: 'KeyT',
      key: 't',
      ctrl: false,
      alt: true,
      shift: false,
      meta: false,
    });

    const delay = screen.getByTestId('ptt-release-delay');
    expect(delay).toHaveAttribute('max', '2000');
    fireEvent.change(delay, { target: { value: '1500' } });
    expect(prefs().pttReleaseDelayMs).toBe(1500);
    expect(delay).toHaveAttribute('aria-valuetext', '1.50 s');
  });

  it('voice activity: automatic sensitivity by default, else a threshold slider', () => {
    render(<VoiceSettingsPage />);
    expect(screen.queryByTestId('sensitivity-threshold')).toBeNull();
    fireEvent.click(
      screen.getByRole('switch', { name: 'Automatically determine input sensitivity' }),
    );
    expect(prefs().inputSensitivityAuto).toBe(false);
    const threshold = screen.getByTestId('sensitivity-threshold');
    fireEvent.change(threshold, { target: { value: '-42' } });
    expect(prefs().inputSensitivityDb).toBe(-42);
    expect(screen.getByText(/start the mic test/i)).toBeInTheDocument();
  });

  it('voice processing switches', () => {
    render(<VoiceSettingsPage />);
    fireEvent.click(screen.getByRole('switch', { name: 'Noise cancellation' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Echo cancellation' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Automatic gain control' }));
    expect(prefs()).toMatchObject({
      noiseCancellation: false,
      echoCancellation: false,
      autoGainControl: false,
    });
  });

  it('Let’s Check starts the mic test; leaving the page stops it', () => {
    const { unmount } = render(<VoiceSettingsPage />);
    fireEvent.click(screen.getByTestId('mic-test'));
    expect(micTest.startMicTest).toHaveBeenCalled();
    unmount();
    expect(micTest.stopMicTest).toHaveBeenCalled();
  });
});
