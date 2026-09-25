/**
 * Module registry. Every module is pre-wired here so feature work never has to touch this
 * file: fill in the module's own routes.ts / socket.ts instead.
 */
import type { Router } from 'express';
import type { SocketRegistrar } from '../realtime/types.js';
import { publicRouter as systemPublic } from './system/routes.js';
import { publicRouter as authPublic, router as auth } from './auth/routes.js';
import { router as users } from './users/routes.js';
import { router as media } from './media/routes.js';
import { router as chats } from './chats/routes.js';
import { router as messages } from './messages/routes.js';
import { router as groups } from './groups/routes.js';
import { router as invites } from './invites/routes.js';
import { router as communities } from './communities/routes.js';
import { router as channels } from './channels/routes.js';
import { router as status } from './status/routes.js';
import { router as calls } from './calls/routes.js';
import { router as push } from './push/routes.js';
import { registerUsersSocket } from './users/socket.js';
import { registerChatsSocket } from './chats/socket.js';
import { registerCallsSocket } from './calls/socket.js';

/** Mounted under /api without authentication. */
export const publicRouters: Router[] = [systemPublic, authPublic];

/** Mounted under /api behind requireAuth. */
export const authedRouters: Router[] = [auth, users, media, chats, messages, groups, invites, communities, channels, status, calls, push];

export const socketRegistrars: SocketRegistrar[] = [registerUsersSocket, registerChatsSocket, registerCallsSocket];
