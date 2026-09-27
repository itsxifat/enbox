/**
 * Open a user's profile card from anywhere (names in bubbles, mentions, member lists): the
 * `ProfileHost` mounted in the app layout shows it as a bottom sheet (the web's phone form).
 */
import { bus } from '@/lib/bus';

export function openProfile(userId) {
  if (userId) bus.emit('profile:open', { userId, anchor: null });
}
