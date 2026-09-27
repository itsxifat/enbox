/**
 * Profile photo and banner pipelines (web settings/profile/avatar.ts + banner.ts), with the
 * system cropper in place of the web crop dialogs:
 * - photo: square crop → JPEG ≤ AVATAR_MAX_DIMENSION (≤ MAX_AVATAR_BYTES) → upload → PATCH /me
 * - banner: 5:2 crop → JPEG ≤ 1600px wide (≤ MAX_BANNER_BYTES) → upload → PATCH /me
 * - a GIF keeps its bytes (the animation) with a still poster; the server serves it as
 *   `avatarAnimatedUrl` / `bannerAnimatedUrl`.
 */
import {
  AVATAR_MAX_DIMENSION,
  BANNER_ASPECT,
  MAX_ANIMATED_AVATAR_BYTES,
  MAX_AVATAR_BYTES,
  MAX_BANNER_BYTES,
  formatBytes,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { encodeJpeg, isAnimatedImage, pickOne, posterOf } from '@/lib/imagePick';
import { useAuth } from '@/stores/auth';

const BANNER_MAX_DIMENSION = 1600;

async function encodeUnder(file, max, limit) {
  let quality = 0.9;
  let out = await encodeJpeg(file, max, quality);
  while (out.size && out.size > limit && quality > 0.5) {
    quality -= 0.15;
    out = await encodeJpeg(file, max, quality);
  }
  return out;
}

async function patchMe(body) {
  const user = await api.patch('/api/me', body);
  useAuth.getState().setUser(user);
  return user;
}

/** Pick → encode → upload → set. Returns false when the picker was dismissed. */
export async function changeAvatar(source) {
  const file = await pickOne({ aspect: [1, 1], source, title: 'Profile photo' });
  if (!file) return false;
  if (!file.type?.startsWith('image/') || file.type === 'image/svg+xml')
    throw new Error('Choose a photo (JPEG, PNG, WebP or GIF).');
  let media;
  if (isAnimatedImage(file)) {
    if (file.size && file.size > MAX_ANIMATED_AVATAR_BYTES)
      throw new Error(
        `Animated photos can be up to ${formatBytes(MAX_ANIMATED_AVATAR_BYTES)}. Choose a smaller one or a still photo.`,
      );
    const poster = await posterOf(file, AVATAR_MAX_DIMENSION);
    if (!poster) throw new Error('Could not make a still image for this animation');
    media = await api.upload(
      file,
      { kind: 'image', width: file.width, height: file.height },
      null,
      {
        fileName: file.name,
        thumbnail: poster,
      },
    );
  } else {
    const out = await encodeUnder(file, AVATAR_MAX_DIMENSION, MAX_AVATAR_BYTES);
    media = await api.upload(out, { kind: 'image', width: out.width, height: out.height }, null, {
      fileName: 'avatar.jpg',
    });
  }
  await patchMe({ avatarMediaId: media.id });
  return true;
}

export function removeAvatar() {
  return patchMe({ avatarMediaId: null });
}

export async function changeBanner(source) {
  const file = await pickOne({ aspect: [...BANNER_ASPECT], source, title: 'Profile banner' });
  if (!file) return false;
  if (!file.type?.startsWith('image/') || file.type === 'image/svg+xml')
    throw new Error('Choose an image (JPEG, PNG, WebP or GIF).');
  let media;
  if (isAnimatedImage(file)) {
    if (file.size && file.size > MAX_BANNER_BYTES)
      throw new Error(`Animated banners can be up to ${formatBytes(MAX_BANNER_BYTES)}.`);
    const poster = await posterOf(file, 960);
    if (!poster) throw new Error('Could not make a still image for this animation');
    media = await api.upload(
      file,
      { kind: 'image', width: file.width, height: file.height },
      null,
      {
        fileName: file.name,
        thumbnail: poster,
      },
    );
  } else {
    const out = await encodeUnder(file, BANNER_MAX_DIMENSION, MAX_BANNER_BYTES);
    media = await api.upload(out, { kind: 'image', width: out.width, height: out.height }, null, {
      fileName: 'banner.jpg',
    });
  }
  await patchMe({ bannerMediaId: media.id });
  return true;
}

export function removeBanner() {
  return patchMe({ bannerMediaId: null });
}
