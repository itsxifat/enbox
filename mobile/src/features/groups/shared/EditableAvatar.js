/**
 * Avatar with a camera badge (web features/groups/shared/EditableAvatar.tsx): pick a photo
 * (gallery or camera, system cropper) → upload (re-encoded JPEG, or a GIF with its poster) →
 * `onUploaded`. With a current photo and `onRemove`, a menu offers "Upload" / "Remove". Used
 * for group, community and channel icons.
 */
import { useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Camera, ImageUp, Trash2 } from 'lucide-react-native';
import { AVATAR_MAX_DIMENSION } from '@enbox/shared';
import { ICON_STROKE_ON_FILL, Icon } from '@/components/icons';
import { Avatar, Menu, Press, measureAnchor, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { encodeJpeg, isAnimatedImage, pickOne, posterOf } from '@/lib/imagePick';
import { useTheme } from '@/theme';

/** Pick + prepare + upload a square icon; resolves to the media (null when dismissed). */
export async function pickAndUploadIcon({ square, onProgress } = {}) {
  const file = await pickOne({ aspect: [1, 1], title: square ? 'Community icon' : 'Group icon' });
  if (!file) return null;
  if (!file.type?.startsWith('image/') || file.type === 'image/svg+xml')
    throw new Error('Choose a photo (JPEG, PNG, WebP or GIF)');
  if (isAnimatedImage(file)) {
    const thumbnail = await posterOf(file, AVATAR_MAX_DIMENSION);
    return api.upload(file, { kind: 'image', width: file.width, height: file.height }, onProgress, {
      fileName: file.name,
      thumbnail,
    });
  }
  const out = await encodeJpeg(file, AVATAR_MAX_DIMENSION, 0.9);
  return api.upload(out, { kind: 'image', width: out.width, height: out.height }, onProgress, {
    fileName: 'icon.jpg',
  });
}

function ProgressRing({ value, size }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <Svg viewBox="0 0 40 40" width={size} height={size}>
      <Circle cx="20" cy="20" r={r} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
      <Circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.05, value))}
        transform="rotate(-90 20 20)"
      />
    </Svg>
  );
}

export function EditableAvatar({
  src,
  animatedSrc,
  name,
  colorSeed,
  kind,
  size,
  editable = true,
  onUploaded,
  onRemove,
  label,
  style,
}) {
  const { tw, c, shadow } = useTheme();
  const ref = useRef(null);
  const [anchor, setAnchor] = useState(null);
  const [progress, setProgress] = useState(null);

  const avatar = (
    <Avatar
      src={src}
      animatedSrc={animatedSrc}
      name={name || 'New'}
      colorSeed={colorSeed}
      kind={kind}
      size={size}
    />
  );
  if (!editable) return <View style={style}>{avatar}</View>;

  const pick = async () => {
    try {
      setProgress(0);
      const media = await pickAndUploadIcon({
        square: kind === 'community',
        onProgress: (p) => setProgress(p),
      });
      if (media) await onUploaded(media);
    } catch (e) {
      toast.error(e);
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const radius = kind === 'community' ? size * 0.28 : size / 2;
  const badge = Math.max(24, size * 0.26);

  return (
    <>
      <Press
        ref={ref}
        feedback={false}
        accessibilityLabel={label}
        disabled={busy}
        onPress={async () => {
          if (src && onRemove) {
            setAnchor(await measureAnchor(ref));
          } else void pick();
        }}
        style={[{ width: size, height: size, borderRadius: radius }, style]}
      >
        {avatar}
        {busy ? (
          <View
            style={[
              tw`absolute inset-0 items-center justify-center bg-black/45`,
              { borderRadius: radius },
            ]}
          >
            <ProgressRing value={progress ?? 0} size={Math.min(56, size * 0.45)} />
          </View>
        ) : (
          <View
            pointerEvents="none"
            style={[
              tw`absolute items-center justify-center rounded-full bg-brand`,
              {
                right: size * 0.04 - 3,
                bottom: size * 0.04 - 3,
                width: badge + 6,
                height: badge + 6,
                borderWidth: 3,
                borderColor: c.surface,
              },
              shadow.sm,
            ]}
          >
            <Icon
              icon={Camera}
              size={Math.round(Math.max(14, size * 0.13))}
              color={c['on-brand']}
              strokeWidth={ICON_STROKE_ON_FILL}
            />
          </View>
        )}
      </Press>
      <Menu
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        align="start"
        items={[
          { label: 'Upload photo', icon: ImageUp, onSelect: () => void pick() },
          onRemove
            ? {
                label: 'Remove photo',
                icon: Trash2,
                danger: true,
                onSelect: () => {
                  void Promise.resolve(onRemove()).catch((e) => toast.error(e));
                },
              }
            : null,
        ]}
      />
    </>
  );
}
