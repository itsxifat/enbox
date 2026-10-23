/**
 * Module registry. Every module is pre-wired here so feature work never has to touch this
 * file: fill in the module's own routes.ts / socket.ts instead.
 */
import type { Router } from 'express';
import type { SocketRegistrar } from '../realtime/types.js';
import { publicRouter as systemPublic } from './system/routes.js';
import { publicRouter as authPublic, router as auth } from './auth/routes.js';
import { router as users } from './users/routes.js';
import { router as userProfiles } from './users/profile.js';
import { router as friends } from './friends/routes.js';
import { router as media } from './media/routes.js';
import { router as chats } from './chats/routes.js';
import { router as messages } from './messages/routes.js';
import { router as search } from './search/routes.js';
import { router as groups } from './groups/routes.js';
import { router as invites } from './invites/routes.js';
import { router as communities } from './communities/routes.js';
import { router as channels } from './channels/routes.js';
import { router as status } from './status/routes.js';
import { router as calls } from './calls/routes.js';
import { router as push } from './push/routes.js';
import { router as linkPreviews } from './linkPreviews/routes.js';
import { router as spaces } from './spaces/routes.js';
import { publicRouter as emojiImages } from './spaces/emojis.js';
import { router as voice } from './voice/routes.js';
import { router as inbox } from './inbox/routes.js';
import { router as threads } from './threads/routes.js';
import { router as forums } from './forums/routes.js';
import { router as events } from './events/routes.js';
import { router as community } from './community/routes.js';
import { router as automod } from './automod/routes.js';
import { router as stickers } from './stickers/routes.js';
import { router as soundboard } from './soundboard/routes.js';
import { router as groupDms } from './groupDms/routes.js';
import { router as mfa } from './mfa/routes.js';
import { registerUsersSocket } from './users/socket.js';
import { registerChatsSocket } from './chats/socket.js';
import { registerCallsSocket } from './calls/socket.js';
import { registerSpacesSocket } from './spaces/socket.js';
import { registerVoiceSocket } from './voice/socket.js';

/** Mounted under /api without authentication. */
export const publicRouters: Router[] = [systemPublic, authPublic, emojiImages];

/** Mounted under /api behind requireAuth. */
export const authedRouters: Router[] = [
  auth,
  users,
  userProfiles,
  friends,
  media,
  chats,
  messages,
  search,
  groups,
  invites,
  communities,
  channels,
  status,
  calls,
  push,
  linkPreviews,
  spaces,
  voice,
  inbox,
  threads,
  forums,
  events,
  community,
  automod,
  stickers,
  soundboard,
  groupDms,
  mfa,
];

export const socketRegistrars: SocketRegistrar[] = [
  registerUsersSocket,
  registerChatsSocket,
  registerCallsSocket,
  registerSpacesSocket,
  registerVoiceSocket,
];
