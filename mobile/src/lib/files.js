/**
 * Opening and saving message attachments on the phone (the web client's `<a download>`):
 * documents download to the cache and open in a viewer app (Android "Open with"); photos and
 * videos can be saved to the gallery.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';
import { toast } from '@/stores/ui';

function safeName(name) {
  return (name || 'file').replace(/[^\w.\- ]+/g, '_').slice(-120);
}

/** Download a remote file into the cache (reused while it's there). */
export async function download(url, name) {
  if (/^(file|content):/i.test(url)) return url;
  const dir = `${FileSystem.cacheDirectory}attachments/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const key = Math.abs([...url].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7));
  const target = `${dir}${key}-${safeName(name)}`;
  const info = await FileSystem.getInfoAsync(target);
  if (info.exists && info.size) return target;
  const res = await FileSystem.downloadAsync(url, target);
  if (res.status < 200 || res.status >= 300) throw new Error(`Download failed (${res.status})`);
  return res.uri;
}

/** Open a document with an installed viewer (falls back to the share sheet). */
export async function openFile(url, name, mimeType) {
  if (Platform.OS === 'web') {
    void Linking.openURL(url);
    return;
  }
  try {
    const local = await download(url, name);
    if (Platform.OS === 'android') {
      try {
        const contentUri = await FileSystem.getContentUriAsync(local);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1,
          type: mimeType || 'application/octet-stream',
        });
        return;
      } catch {
        /* no app for this type: share instead */
      }
    }
    if (await Sharing.isAvailableAsync())
      await Sharing.shareAsync(local, { mimeType, dialogTitle: name });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Couldn’t open the file');
  }
}

/** Share a file through the Android share sheet. */
export async function shareFile(url, name, mimeType) {
  if (Platform.OS === 'web') return openFile(url, name, mimeType);
  try {
    const local = await download(url, name);
    await Sharing.shareAsync(local, { mimeType, dialogTitle: name });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Couldn’t share the file');
  }
}

/** Save a photo/video to the gallery ("Download" / "Save" actions). */
export async function saveToGallery(url, name) {
  if (Platform.OS === 'web') return openFile(url, name);
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) {
      toast.error('Allow access to photos to save media');
      return;
    }
    const local = await download(url, name);
    await MediaLibrary.saveToLibraryAsync(local);
    toast.success('Saved to gallery');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Couldn’t save');
  }
}
