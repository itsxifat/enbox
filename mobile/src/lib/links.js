/**
 * Open a URL from a message, description or preview. Links to this Enbox server's own pages
 * (`/join/<code>`, `/u/<username>`, `/chats/<id>`, …) open inside the app like they do in the
 * web app; everything else goes to the system browser.
 */
import { Linking } from 'react-native';
import { router } from 'expo-router';
import { getApiOrigin } from './env';
import { publicOrigin, publicUrl } from './serverConfig';

const IN_APP =
  /^\/(?:join\/[A-Za-z0-9]+|u\/[\w.-]+|chats\/[\w-]+|updates\/channels\/[\w-]+|communities\/[\w-]+)\/?$/;

function originOf(url) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** The in-app route for an Enbox link on this server, or null. */
export function inAppPath(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const origins = [originOf(publicOrigin()), originOf(getApiOrigin())].filter(Boolean);
  if (!origins.includes(u.origin) || !IN_APP.test(u.pathname)) return null;
  return u.pathname.replace(/\/$/, '') + u.search;
}

export function openUrl(href) {
  const path = inAppPath(href);
  if (path) router.push(path);
  else void Linking.openURL(href).catch(() => undefined);
}

/** Spaces aren't in the app yet: open them on the web (canonical origin). */
export async function openSpacesOnWeb(path = '/spaces') {
  void Linking.openURL(await publicUrl(path)).catch(() => undefined);
}
