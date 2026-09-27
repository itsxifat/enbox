/**
 * Photo / video bubble content (web bubbles/MediaBody.tsx): sized preview, upload progress
 * (cancel), play badge → viewer. Animated images show their poster and a GIF badge until
 * tapped (device pref "Autoplay animated media": on tap), or play right away ("Always").
 */
import { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { ImageOff, Play, RotateCw, X } from 'lucide-react-native';
import Svg, { Circle } from 'react-native-svg';
import { formatDuration } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { Press, T } from '@/components/ui';
import { mediaUrl } from '@/lib/api';
import { useUi } from '@/stores/ui';
import { useTheme } from '@/theme';
import { cancelUpload } from '../lib/sendMedia';

const MAX_W = 330;
const MAX_H = 380;
const MIN_H = 120;

export function mediaBox(width, height) {
  if (!width || !height) return { width: MAX_W, height: Math.round(MAX_W * 0.75) };
  const ratio = width / height;
  let w = Math.min(MAX_W, width);
  let h = w / ratio;
  if (h > MAX_H) {
    h = MAX_H;
    w = Math.max(160, Math.min(MAX_W, h * ratio));
  }
  if (h < MIN_H) h = MIN_H;
  return { width: Math.round(w), height: Math.round(h) };
}

export function ProgressRing({ value, onCancel, size = 48 }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0.04, Math.min(1, value ?? 0));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg
        viewBox="0 0 48 48"
        width={size}
        height={size}
        style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}
      >
        <Circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke="#fff"
          strokeOpacity={0.25}
          strokeWidth="3"
        />
        <Circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${circ}`}
          strokeDashoffset={circ * (1 - pct)}
        />
      </Svg>
      {onCancel ? (
        <Press
          accessibilityLabel="Cancel upload"
          onPress={onCancel}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          pressedStyle={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
        >
          <Icon icon={X} size={20} color="#fff" />
        </Press>
      ) : null}
    </View>
  );
}

export function MediaBody({ m, onOpen, onRetry, radius = 6, maxWidth, children }) {
  const { tw, dark } = useTheme();
  const media = m.media;
  const [broken, setBroken] = useState(false);
  const [hot, setHot] = useState(false);
  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  const reduceMotion = useUi((s) => s.prefs.reduceMotion === 'on');
  const box = mediaBox(media.width, media.height);
  const width = Math.min(box.width, maxWidth ?? box.width);
  const height = Math.round((box.height * width) / box.width);
  const video = m.type === 'video';
  const uploading = !!m.pending && m.uploadProgress !== undefined && m.uploadProgress < 1;
  const poster = media.thumbnailUrl ? mediaUrl(media.thumbnailUrl) : undefined;
  const animated = !video && (media.animated || media.mimeType === 'image/gif');
  const canPlay = animated && autoplay !== 'never' && !reduceMotion;
  const playing = canPlay && (autoplay === 'always' || hot);
  const src = video || (animated && !playing) ? poster : mediaUrl(m.localUrl ?? media.url);

  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.1)',
      }}
    >
      <Press
        feedback={false}
        accessibilityLabel={
          video ? 'Play video' : animated ? (playing ? 'Open GIF' : 'Play GIF') : 'Open photo'
        }
        onPress={() => {
          if (uploading || m.failed) return;
          if (canPlay && autoplay !== 'always' && !hot) setHot(true);
          else onOpen();
        }}
        style={tw`absolute inset-0`}
      >
        {src && !broken ? (
          <Image
            source={{ uri: src }}
            placeholder={!video && !animated && poster ? { uri: poster } : undefined}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={200}
            autoplay={playing}
            recyclingKey={src}
            onError={() => setBroken(true)}
          />
        ) : video && !broken ? (
          <View style={[tw`absolute inset-0`, { backgroundColor: '#15141c' }]} />
        ) : animated && !broken ? (
          <View style={tw`absolute inset-0 items-center justify-center`}>
            <Play size={28} color="rgba(128,128,140,0.8)" fill="rgba(128,128,140,0.8)" />
          </View>
        ) : (
          <View style={tw`absolute inset-0 items-center justify-center gap-2`}>
            <Icon icon={ImageOff} size={28} color="#8a8898" />
            <T style={tw`text-xs text-muted`}>Media unavailable</T>
          </View>
        )}
      </Press>

      {animated && !playing && !uploading && !m.failed ? (
        <View
          pointerEvents="none"
          style={tw`absolute top-1.5 left-1.5 rounded-md bg-black/55 px-1.5 py-0.5`}
        >
          <T style={[tw`text-[10px] font-bold text-white`, { letterSpacing: 1 }]}>GIF</T>
        </View>
      ) : null}

      {video && !uploading && !m.failed ? (
        <>
          <View pointerEvents="none" style={tw`absolute inset-0 items-center justify-center`}>
            <View style={tw`size-12 items-center justify-center rounded-full bg-black/45`}>
              <Play size={22} color="#fff" fill="#fff" style={{ marginLeft: 2 }} />
            </View>
          </View>
          {media.durationMs ? (
            <View
              pointerEvents="none"
              style={tw`absolute bottom-1.5 left-2 flex-row items-center gap-1`}
            >
              <Play size={10} color="#fff" fill="#fff" />
              <T
                style={[
                  tw`text-[11px] font-medium text-white`,
                  { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 2 },
                ]}
              >
                {formatDuration(media.durationMs)}
              </T>
            </View>
          ) : null}
        </>
      ) : null}

      {uploading ? (
        <View style={tw`absolute inset-0 items-center justify-center`}>
          <ProgressRing
            value={m.uploadProgress}
            onCancel={m.clientId ? () => cancelUpload(m.clientId) : undefined}
          />
        </View>
      ) : null}
      {m.failed ? (
        <View style={tw`absolute inset-0 items-center justify-center`}>
          <Press
            onPress={onRetry}
            style={tw`h-10 flex-row items-center gap-2 rounded-full bg-black/55 px-4`}
            pressedStyle={tw`bg-black/65`}
          >
            <Icon icon={RotateCw} size={16} color="#fff" />
            <T style={tw`text-sm font-medium text-white`}>Retry</T>
          </Press>
        </View>
      ) : null}
      {children ? (
        <View pointerEvents="none" style={tw`absolute right-1.5 bottom-1.5`}>
          {children}
        </View>
      ) : null}
    </View>
  );
}
