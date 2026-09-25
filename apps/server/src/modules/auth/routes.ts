import { Router, type Request } from 'express';
import { and, asc, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import {
  DEFAULT_ABOUT,
  DELETED_USERNAME_PREFIX,
  changePasswordSchema,
  idParamSchema,
  loginSchema,
  parseLoginIdentifier,
  registerSchema,
  usernameAvailabilityQuerySchema,
  type AuthResponse,
  type SessionInfo,
  type UsernameAvailability,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { sessions, users } from '../../db/schema.js';
import { authCtx } from '../../http/auth.js';
import { hashPassword } from '../../lib/crypto.js';
import { conflict, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { authLimiter, usernameCheckLimiter } from '../../lib/rateLimit.js';
import { parse } from '../../lib/validate.js';
import { Effects, transact } from '../../services/effects.js';
import { createSession } from '../../services/sessions.js';
import { getUserRow, requireUser, toUserSelf } from '../../services/users.js';
import { checkPassword, isUniqueViolation, revokeSessionsEffect } from './service.js';

/**
 * Auth module (docs "Accounts, sessions and deletion").
 * publicRouter (no auth): POST /auth/register, POST /auth/login (per-IP `authLimiter`),
 *                         GET /auth/username-available (per-IP `usernameCheckLimiter`)
 * router (authenticated): POST /auth/logout, GET/DELETE /auth/sessions[/:sessionId],
 *                         POST /auth/change-password
 *
 * - Passwords: scrypt (lib/crypto). Unknown/deleted accounts are verified against a dummy
 *   hash (same timing) and fail with the same 401 as a wrong password.
 * - Sessions = linked devices; device name from the body or guessed from the User-Agent.
 * - Revocation (log out other devices, revoke one, password change): rows deleted in one
 *   tx, then per session `invalidateSessions` → `session:revoked` → session room →
 *   `disconnectSession`. Push subscriptions cascade with their session.
 * - A wrong current password on authenticated routes is `403 forbidden` (never 401, which
 *   clients treat as "session expired").
 */
export const publicRouter = Router();
export const router = Router();

function clientInfo(req: Request) {
  return { userAgent: req.get('user-agent')?.slice(0, 512) ?? null, ip: req.ip ?? null };
}

function invalidCredentials() {
  return unauthorized('Incorrect username, phone number or password');
}

/**
 * Register form helper: `{ available }` for a well-formed username (malformed → 400). False
 * when any account holds it — deleted accounts included (their scrubbed `deleted_…` names) —
 * or when it is reserved (`deleted_` prefix), i.e. exactly when register would refuse it.
 */
publicRouter.get('/auth/username-available', usernameCheckLimiter, async (req, res) => {
  const { username } = parse(usernameAvailabilityQuerySchema, req.query);
  let available = !username.startsWith(DELETED_USERNAME_PREFIX);
  if (available) {
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    available = !taken;
  }
  const response: UsernameAvailability = { available };
  res.set('Cache-Control', 'no-store');
  res.json(response);
});

publicRouter.post('/auth/register', authLimiter, async (req, res) => {
  const body = parse(registerSchema, req.body ?? {});
  const passwordHash = await hashPassword(body.password);
  const phone = body.phone ?? null;

  const out = await db
    .transaction(async (tx) => {
      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, body.username))
        .limit(1);
      if (taken) throw conflict('This username is taken');
      if (phone) {
        const [used] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.phone, phone))
          .limit(1);
        if (used) throw conflict('This phone number is already registered');
      }
      const [row] = await tx
        .insert(users)
        .values({
          username: body.username,
          displayName: body.displayName,
          phone,
          passwordHash,
          about: DEFAULT_ABOUT,
        })
        .returning();
      const { token } = await createSession(
        { userId: row!.id, deviceName: body.deviceName, ...clientInfo(req) },
        tx,
      );
      return { token, userId: row!.id };
    })
    .catch((err: unknown) => {
      // Concurrent registrations: the unique indexes are the final arbiter.
      if (isUniqueViolation(err, 'users_username_uq')) throw conflict('This username is taken');
      if (isUniqueViolation(err, 'users_phone_uq'))
        throw conflict('This phone number is already registered');
      throw err;
    });

  const user = await requireUser(db, out.userId);
  const response: AuthResponse = { token: out.token, user: toUserSelf(user) };
  res.status(201).json(response);
});

publicRouter.post('/auth/login', authLimiter, async (req, res) => {
  const body = parse(loginSchema, req.body ?? {});
  const id = parseLoginIdentifier(body.identifier);
  let row: { id: string; passwordHash: string; deletedAt: Date | null } | undefined;
  if (id) {
    [row] = await db
      .select({ id: users.id, passwordHash: users.passwordHash, deletedAt: users.deletedAt })
      .from(users)
      .where(id.kind === 'phone' ? eq(users.phone, id.phone) : eq(users.username, id.username))
      .limit(1);
  }
  // Unknown or deleted accounts cost the same as a wrong password and fail identically.
  if (!(await checkPassword(row, body.password)) || !row) throw invalidCredentials();

  const { token } = await createSession({
    userId: row.id,
    deviceName: body.deviceName,
    ...clientInfo(req),
  });
  const user = await getUserRow(db, row.id);
  if (!user || user.deletedAt) throw invalidCredentials();
  const response: AuthResponse = { token, user: toUserSelf(user) };
  res.json(response);
});

/** Log out this device: delete the session (push subscriptions cascade), then drop its sockets. */
async function logout(sessionId: string) {
  const fx = new Effects();
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  revokeSessionsEffect(fx, [sessionId], { notify: false });
  await fx.commit();
}

router.post('/auth/logout', async (req, res) => {
  await logout(authCtx(req).sessionId);
  res.status(204).end();
});

router.get('/auth/sessions', async (req, res) => {
  const me = authCtx(req);
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, me.userId), gt(sessions.expiresAt, new Date())))
    .orderBy(
      desc(sql`${sessions.id} = ${me.sessionId}`),
      desc(sessions.lastActiveAt),
      asc(sessions.createdAt),
    );
  const list: SessionInfo[] = rows.map((s) => ({
    id: s.id,
    deviceName: s.deviceName,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastActiveAt: s.lastActiveAt.toISOString(),
    current: s.id === me.sessionId,
  }));
  res.json(list);
});

/** Log out all OTHER devices. */
router.delete('/auth/sessions', async (req, res) => {
  const me = authCtx(req);
  await transact(async (tx, fx) => {
    const revoked = await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, me.userId), ne(sessions.id, me.sessionId)))
      .returning({ id: sessions.id });
    revokeSessionsEffect(
      fx,
      revoked.map((r) => r.id),
    );
  });
  res.status(204).end();
});

/** Revoke one of MY sessions (others' → 404); the current one = logout. */
router.delete('/auth/sessions/:sessionId', async (req, res) => {
  const me = authCtx(req);
  const { sessionId } = parse(idParamSchema('sessionId'), req.params);
  if (sessionId === me.sessionId) {
    await logout(sessionId);
    res.status(204).end();
    return;
  }
  await transact(async (tx, fx) => {
    const revoked = await tx
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, me.userId)))
      .returning({ id: sessions.id });
    if (revoked.length === 0) throw notFound('Session');
    revokeSessionsEffect(fx, [sessionId]);
  });
  res.status(204).end();
});

/** Change my password; every OTHER session is revoked in the same transaction. */
router.post('/auth/change-password', authLimiter, async (req, res) => {
  const me = authCtx(req);
  const body = parse(changePasswordSchema, req.body ?? {});
  const user = await requireUser(db, me.userId);
  if (!(await checkPassword(user, body.currentPassword)))
    throw forbidden('Your current password is incorrect');
  const passwordHash = await hashPassword(body.newPassword);
  await transact(async (tx, fx) => {
    // Compare-and-set: a concurrent change on another device wins, this one fails.
    const updated = await tx
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(
        and(
          eq(users.id, me.userId),
          eq(users.passwordHash, user.passwordHash),
          isNull(users.deletedAt),
        ),
      )
      .returning({ id: users.id });
    if (updated.length === 0) throw conflict('Your password was just changed on another device');
    const revoked = await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, me.userId), ne(sessions.id, me.sessionId)))
      .returning({ id: sessions.id });
    revokeSessionsEffect(
      fx,
      revoked.map((r) => r.id),
    );
  });
  res.status(204).end();
});
