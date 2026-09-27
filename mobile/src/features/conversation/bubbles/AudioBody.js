/** Voice notes (waveform, speed) and audio files (progress bar) with the shared player. */
import { useRef } from 'react';
import { View } from 'react-native';
import { Headphones, Mic, Pause, Play } from 'lucide-react-native';
import { formatDuration } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { ICON_STROKE_BOLD, Icon } from '@/components/icons';
import { Press, T } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import { alpha, useTheme } from '@/theme';
import { cycleRate, seekTo, togglePlay, usePlayer } from '../lib/audioPlayer';
import { cancelUpload } from '../lib/sendMedia';
import { fallbackWaveform, resampleWaveform } from '../lib/waveform';
import { ProgressRing } from './MediaBody';

const BARS = 36;

function useTrack(m) {
  const media = m.media;
  const id = m.clientId ?? m.id;
  const src = mediaUrl(m.localUrl ?? media.url) ?? '';
  const active = usePlayer((s) => s.id === id);
  const playing = usePlayer((s) => s.id === id && s.playing);
  const position = usePlayer((s) => (s.id === id ? s.position : 0));
  const liveDuration = usePlayer((s) => (s.id === id ? s.duration : 0));
  const rate = usePlayer((s) => s.rate);
  const durationS = liveDuration || (media.durationMs ?? 0) / 1000;
  const progress = durationS > 0 ? Math.min(1, position / durationS) : 0;
  return {
    id,
    src,
    active,
    playing,
    position,
    durationS,
    progress,
    rate,
    durationMs: media.durationMs,
  };
}

/** A touch seek bar: tap or drag to seek (children never take the touch, so x is ours). */
function Seekbar({ progress, onSeek, children, style }) {
  const width = useRef(1);
  const at = (x) => Math.max(0, Math.min(1, x / width.current));
  return (
    <View
      onLayout={(e) => (width.current = e.nativeEvent.layout.width || 1)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => onSeek(at(e.nativeEvent.locationX))}
      onResponderMove={(e) => onSeek(at(e.nativeEvent.locationX))}
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
    >
      <View pointerEvents="none" style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>
        {children}
      </View>
    </View>
  );
}

function PlayButton({ playing, onPress, label }) {
  const { tw, c } = useTheme();
  return (
    <Press
      accessibilityLabel={playing ? `Pause ${label}` : `Play ${label}`}
      onPress={onPress}
      style={tw`size-10 items-center justify-center rounded-full`}
    >
      {playing ? (
        <Pause size={26} color={c.muted} fill={c.muted} />
      ) : (
        <Play size={26} color={c.muted} fill={c.muted} style={{ marginLeft: 2 }} />
      )}
    </Press>
  );
}

function RateChip({ rate }) {
  const { tw, dark } = useTheme();
  return (
    <Press
      accessibilityLabel={`Playback speed ${rate}×`}
      onPress={cycleRate}
      feedback={false}
      style={[
        tw`rounded-full px-1.5`,
        { backgroundColor: dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' },
      ]}
    >
      <T style={tw`text-[10px] font-semibold`}>{rate}×</T>
    </Press>
  );
}

export function VoiceBody({ m, mine, meta, width }) {
  const { tw, c } = useTheme();
  const t = useTrack(m);
  const bars = resampleWaveform(
    m.media.waveform?.length ? m.media.waveform : fallbackWaveform(m.media.id, BARS),
    BARS,
  );
  const uploading = !!m.pending && m.uploadProgress !== undefined && m.uploadProgress < 1;
  const shown = t.active && t.position > 0 ? t.position : t.durationS;
  const metaColor = mine ? c['bubble-out-meta'] : c['bubble-in-meta'];
  return (
    <View
      style={[tw`flex-row items-center gap-1.5 py-0.5`, { width: Math.min(290, width ?? 290) }]}
    >
      {uploading ? (
        <View style={{ transform: [{ scale: 0.8 }] }}>
          <ProgressRing
            value={m.uploadProgress}
            onCancel={m.clientId ? () => cancelUpload(m.clientId) : undefined}
          />
        </View>
      ) : (
        <PlayButton
          playing={t.playing}
          label="voice message"
          onPress={() => togglePlay(t.id, t.src, t.durationMs)}
        />
      )}
      <View style={tw`min-w-0 flex-1 gap-1`}>
        <Seekbar
          progress={t.progress}
          onSeek={(f) => seekTo(t.id, t.src, f, t.durationMs)}
          style={[tw`h-8`, { gap: 2 }]}
        >
          {bars.map((v, i) => {
            const played = (i + 0.5) / bars.length <= t.progress;
            return (
              <View
                key={i}
                style={{
                  flex: 1,
                  minWidth: 2,
                  borderRadius: 2,
                  height: `${Math.max(12, Math.round(v * 100))}%`,
                  backgroundColor: played ? (mine ? c['brand-ink'] : c.brand) : alpha(c.fg, 0.3),
                }}
              />
            );
          })}
          {t.active ? (
            <View
              pointerEvents="none"
              style={[
                tw`absolute size-3 rounded-full bg-brand`,
                { left: `${t.progress * 100}%`, marginLeft: -6, top: 10 },
              ]}
            />
          ) : null}
        </Seekbar>
        <View style={tw`h-4 flex-row items-center gap-2`}>
          <T style={[tw`text-[11px]`, { color: metaColor, fontVariant: ['tabular-nums'] }]}>
            {formatDuration(shown * 1000)}
          </T>
          {t.active ? <RateChip rate={t.rate} /> : null}
          {meta ? <View style={tw`ml-auto`}>{meta}</View> : null}
        </View>
      </View>
      <View style={tw`ml-1`}>
        <UserAvatar userId={m.senderId} size={44} />
        <View style={tw`absolute -right-0.5 -bottom-0.5`}>
          <Icon
            icon={Mic}
            size={16}
            strokeWidth={ICON_STROKE_BOLD}
            color={t.progress > 0 || t.playing ? c['brand-ink'] : c['tick-read']}
          />
        </View>
      </View>
    </View>
  );
}

export function AudioFileBody({ m, mine, width }) {
  const { tw, c } = useTheme();
  const t = useTrack(m);
  const uploading = !!m.pending && m.uploadProgress !== undefined && m.uploadProgress < 1;
  const shown = t.active && t.position > 0 ? t.position : t.durationS;
  return (
    <View style={[tw`flex-row items-center gap-2 py-1`, { width: Math.min(290, width ?? 290) }]}>
      <View style={tw`size-11 items-center justify-center rounded-full bg-warning`}>
        <Icon icon={Headphones} size={22} color="#fff" />
      </View>
      {uploading ? (
        <View style={{ transform: [{ scale: 0.8 }] }}>
          <ProgressRing
            value={m.uploadProgress}
            onCancel={m.clientId ? () => cancelUpload(m.clientId) : undefined}
          />
        </View>
      ) : (
        <PlayButton
          playing={t.playing}
          label="audio"
          onPress={() => togglePlay(t.id, t.src, t.durationMs)}
        />
      )}
      <View style={tw`min-w-0 flex-1 gap-1.5`}>
        <T numberOfLines={1} style={tw`text-[13px] font-medium`}>
          {m.media.fileName ?? 'Audio'}
        </T>
        <Seekbar
          progress={t.progress}
          onSeek={(f) => seekTo(t.id, t.src, f, t.durationMs)}
          style={tw`h-3`}
        >
          <View style={[tw`h-1 w-full rounded-full`, { backgroundColor: alpha(c.fg, 0.25) }]} />
          <View
            style={[
              tw`absolute left-0 h-1 rounded-full bg-brand`,
              { width: `${t.progress * 100}%` },
            ]}
          />
          <View
            style={[
              tw`absolute size-3 rounded-full bg-brand`,
              { left: `${t.progress * 100}%`, marginLeft: -6 },
            ]}
          />
        </Seekbar>
        <View style={tw`flex-row items-center gap-2`}>
          <T
            style={[
              tw`text-[11px]`,
              {
                color: mine ? c['bubble-out-meta'] : c['bubble-in-meta'],
                fontVariant: ['tabular-nums'],
              },
            ]}
          >
            {formatDuration(shown * 1000)}
          </T>
          {t.active ? <RateChip rate={t.rate} /> : null}
        </View>
      </View>
    </View>
  );
}
