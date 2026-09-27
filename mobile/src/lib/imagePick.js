/**
 * Picking a single photo for a profile photo, banner, group icon or wallpaper: gallery or
 * camera (the system cropper frames it to `aspect`), then a JPEG re-encode (strips EXIF /
 * GPS, applies orientation) with the longest side ≤ `max`. GIFs keep their bytes (the
 * animation) and get a still poster. The web client's crop dialogs map onto the system
 * cropper here.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { fromPickerAsset, makeThumbnail } from '@/features/conversation/lib/mediaProcessing';
import { choose, toast } from '@/stores/ui';

async function sizeOf(uri) {
  if (Platform.OS === 'web') return undefined;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? info.size : undefined;
  } catch {
    return undefined;
  }
}

/** Ask where the photo comes from (Camera / Gallery); null when dismissed. */
export async function chooseSource(title = 'Choose a photo') {
  if (Platform.OS === 'web') return 'gallery';
  return choose({
    title,
    options: [
      { value: 'gallery', label: 'Choose from gallery' },
      { value: 'camera', label: 'Take a photo' },
    ],
  });
}

/**
 * One photo (or, with `video`, a photo or a video) → our file shape, or null when cancelled.
 * `aspect` = [w, h] turns on the system cropper (photos only; GIFs are never cropped).
 */
export async function pickOne({ aspect, source, video = false, title } = {}) {
  const from = source ?? (await chooseSource(title));
  if (!from) return null;
  const opts = {
    mediaTypes: video ? ['images', 'videos'] : ['images'],
    quality: 1,
    exif: false,
    allowsEditing: !!aspect,
    aspect,
  };
  let res;
  if (from === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      toast.error('Allow camera access to take photos');
      return null;
    }
    res = await ImagePicker.launchCameraAsync(opts);
  } else {
    res = await ImagePicker.launchImageLibraryAsync(opts);
  }
  if (res.canceled || !res.assets?.length) return null;
  return fromPickerAsset(res.assets[0]);
}

/** Re-encode a still to JPEG, longest side ≤ `max`: `{ uri, name, type, size, width, height }`. */
export async function encodeJpeg(file, max, quality = 0.9) {
  const ctx = ImageManipulator.manipulate(file.uri);
  const w = file.width;
  const h = file.height;
  if (w && h && Math.max(w, h) > max) {
    if (w >= h) ctx.resize({ width: max });
    else ctx.resize({ height: max });
  }
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ compress: quality, format: SaveFormat.JPEG });
  return {
    uri: out.uri,
    name: file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg',
    type: 'image/jpeg',
    size: await sizeOf(out.uri),
    width: out.width,
    height: out.height,
  };
}

/** A still poster for an animated image (≤ `max` px, JPEG). */
export async function posterOf(file, max = 960) {
  try {
    const out = await encodeJpeg(file, max, 0.8);
    return { uri: out.uri, name: 'poster.jpg', type: 'image/jpeg', size: out.size };
  } catch {
    return makeThumbnail(file.uri, file.width, file.height);
  }
}

export function isAnimatedImage(file) {
  return file.type === 'image/gif';
}
