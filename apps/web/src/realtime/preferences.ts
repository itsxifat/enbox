/**
 * Realtime: me:preferences (everyday wave, agent 3): my synced preferences changed on another
 * device (the whole document; stores/preferencesSync.ts applies it when it is newer than the
 * one applied here). The handlers' registration (signed in) starts the sync and loads the
 * document; every `ready` reloads it, since events missed while offline are not replayed.
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import {
  loadSyncedPreferences,
  receivePreferences,
  startPreferencesSync,
} from '@/stores/preferencesSync';

export function registerPreferencesHandlers(socket: AppSocket): void {
  startPreferencesSync();
  socket.on('me:preferences', (doc) => receivePreferences(doc));
  // Signed in: no need to wait for the handshake (a blocked WebSocket never sends `ready`).
  void loadSyncedPreferences();
}

export async function resyncPreferences(_info: ReadyInfo): Promise<void> {
  await loadSyncedPreferences();
}
