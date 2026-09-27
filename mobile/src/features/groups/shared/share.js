/** Invite-link helpers: absolute join URL, copy and the system share sheet. */
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { publicOrigin } from '@/lib/serverConfig';
import { toast } from '@/stores/ui';

/** Absolute `/join/:code` URL on the canonical origin (the server's PUBLIC_URL once loaded). */
export function inviteUrl(code) {
  return `${publicOrigin()}/join/${code}`;
}

/** Copy text to the clipboard. */
export async function copyText(text) {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

export async function copyLink(url, what = 'Link') {
  if (await copyText(url)) toast.success(`${what} copied`);
  else toast.error("Couldn't copy the link.");
}

/** Kept for the web client's call sites (anchored menus from list rows). */
export function afterPaint(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/** The system share sheet (falls back to copying). */
export async function shareLink({ title, text, url }) {
  try {
    await Share.share({ title, message: text ? `${text}\n${url}` : url, url });
  } catch {
    await copyLink(url);
  }
}
