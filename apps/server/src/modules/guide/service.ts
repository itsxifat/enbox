/**
 * Server Guide, Browse Channels and Channels & Roles rules (docs/design/discord-parity.md
 * W12-B): guide validation, my channel choices, and what new onboarding answers do to my roles.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  PERM,
  hasPerm,
  isSpaceChatType,
  type ChannelPref,
  type OnboardingAnswers,
  type ServerGuide,
  type SpaceOnboarding,
} from '@enbox/shared';
import { z } from 'zod';
import type { DbOrTx } from '../../db/index.js';
import { chats, spaceMemberChannels } from '../../db/schema.js';
import { HttpError, badRequest, notFound } from '../../lib/errors.js';
import {
  channelBits,
  loadChannelOverwrites,
  type SpaceAccess,
} from '../../services/spaceAccess.js';
import { normalizeWelcomeScreen } from '../community/service.js';

const blankToNull = (s: string | null | undefined): string | null => (s?.trim() ? s.trim() : null);

// ---------------------------------------------------------------------------
// Server Guide
// ---------------------------------------------------------------------------

/**
 * 400 unless every id is a text (or forum) channel of this Space that @everyone can see: the
 * welcome screen's rule (`normalizeWelcomeScreen`), since every member reads the guide.
 */
async function assertPublicChannels(
  dbx: DbOrTx,
  access: SpaceAccess,
  spaceId: string,
  ids: readonly string[],
): Promise<void> {
  if (!ids.length) return;
  try {
    await normalizeWelcomeScreen(dbx, access, spaceId, {
      enabled: true,
      description: null,
      channels: ids.map((channelId) => ({ channelId, description: 'guide', emoji: null })),
    });
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 400) throw e;
    throw badRequest(
      e.message
        .replace(/^welcomeScreen: Recommend/, 'guide: Pick')
        .replace(/^welcomeScreen:/, 'guide:'),
    );
  }
}

/**
 * Validate and normalise a guide: each channel once per list (a channel may be a to-do and a
 * resource), channels everyone can see, blank optional texts stored as null.
 */
export async function normalizeGuide(
  dbx: DbOrTx,
  access: SpaceAccess,
  spaceId: string,
  input: ServerGuide,
): Promise<ServerGuide> {
  const todoIds = input.todos.map((t) => t.channelId);
  const resourceIds = input.resources.map((r) => r.channelId);
  if (new Set(todoIds).size !== todoIds.length)
    throw badRequest('guide: Give each to-do its own channel');
  if (new Set(resourceIds).size !== resourceIds.length)
    throw badRequest('guide: Give each resource page its own channel');
  await assertPublicChannels(dbx, access, spaceId, [...new Set([...todoIds, ...resourceIds])]);
  return {
    enabled: input.enabled,
    welcome: { title: input.welcome.title.trim(), subtitle: blankToNull(input.welcome.subtitle) },
    todos: input.todos.map((t) => ({
      channelId: t.channelId,
      emoji: blankToNull(t.emoji),
      description: t.description.trim(),
    })),
    resources: input.resources.map((r) => ({
      channelId: r.channelId,
      title: r.title.trim(),
      description: blankToNull(r.description),
      emoji: blankToNull(r.emoji),
    })),
  };
}

// ---------------------------------------------------------------------------
// Browse Channels
// ---------------------------------------------------------------------------

/** My choices in a Space (rows only where I changed a channel's default). */
export async function loadChannelPrefs(
  dbx: DbOrTx,
  spaceId: string,
  userId: string,
): Promise<ChannelPref[]> {
  return dbx
    .select({ channelId: spaceMemberChannels.channelId, shown: spaceMemberChannels.shown })
    .from(spaceMemberChannels)
    .where(and(eq(spaceMemberChannels.spaceId, spaceId), eq(spaceMemberChannels.userId, userId)))
    .orderBy(asc(spaceMemberChannels.channelId));
}

/**
 * Save my choices: channels of this Space I can see (404 otherwise, like a channel that isn't
 * there; threads follow their channel). A choice equal to the channel's default (opt-in:
 * hidden, else shown) drops my row, so a channel switched to or from opt-in later follows
 * the new default unless I chose otherwise. The last choice of a channel in the batch wins.
 */
export async function saveChannelPrefs(
  dbx: DbOrTx,
  access: SpaceAccess,
  spaceId: string,
  userId: string,
  prefs: readonly ChannelPref[],
): Promise<void> {
  const wanted = new Map(prefs.map((p) => [p.channelId, p.shown]));
  const ids = [...wanted.keys()];
  const rows = await dbx
    .select({ id: chats.id, type: chats.type, optIn: chats.optIn })
    .from(chats)
    .where(and(eq(chats.spaceId, spaceId), inArray(chats.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const overwrites = await loadChannelOverwrites(dbx, ids);
  for (const id of ids) {
    const ch = byId.get(id);
    if (!ch || !isSpaceChatType(ch.type) || ch.type === 'space_thread') throw notFound('Channel');
    const bits = channelBits(
      access.ctx,
      userId,
      access.me,
      ch.type,
      overwrites.get(id) ?? [],
      access.base,
    );
    if (!hasPerm(bits, PERM.VIEW_CHANNEL)) throw notFound('Channel');
  }
  const isDefault = (id: string) => wanted.get(id) === !byId.get(id)!.optIn;
  const drop = ids.filter(isDefault);
  const keep = ids.filter((id) => !isDefault(id));
  if (drop.length)
    await dbx
      .delete(spaceMemberChannels)
      .where(
        and(eq(spaceMemberChannels.userId, userId), inArray(spaceMemberChannels.channelId, drop)),
      );
  if (keep.length)
    await dbx
      .insert(spaceMemberChannels)
      .values(
        keep.map((channelId) => ({ spaceId, userId, channelId, shown: wanted.get(channelId)! })),
      )
      .onConflictDoUpdate({
        target: [spaceMemberChannels.userId, spaceMemberChannels.channelId],
        set: { shown: sql`excluded.shown`, updatedAt: new Date() },
      });
}

// ---------------------------------------------------------------------------
// Channels & Roles (my onboarding answers)
// ---------------------------------------------------------------------------

const optionId = z.string().trim().min(1).max(40);

/** `PUT /api/spaces/:spaceId/onboarding/answers`: prompt id → picked option ids. */
export const changeAnswersSchema = z.object({
  answers: z
    .record(optionId, z.array(optionId).max(20))
    .refine((a) => Object.keys(a).length <= 15, 'Too many questions'),
});

const STALE = 'answers: These questions changed. Reload and try again.';

/** My picks as answers: each prompt with picks → its picked options, in the prompt's order. */
export function answersOf(
  onboarding: SpaceOnboarding,
  optionIds: readonly string[],
): OnboardingAnswers {
  const picked = new Set(optionIds);
  const out: OnboardingAnswers = {};
  for (const p of onboarding.prompts) {
    const mine = p.options.filter((o) => picked.has(o.id)).map((o) => o.id);
    if (mine.length) out[p.id] = mine;
  }
  return out;
}

/**
 * New answers checked against the current questions: known questions and their own options
 * (else 400: they changed), required questions answered, single-select ones once. Normalised
 * (`answersOf`).
 */
export function validateAnswers(
  onboarding: SpaceOnboarding,
  answers: OnboardingAnswers,
): OnboardingAnswers {
  const prompts = new Map(onboarding.prompts.map((p) => [p.id, p]));
  for (const [promptId, ids] of Object.entries(answers)) {
    const p = prompts.get(promptId);
    if (!p) throw badRequest(STALE);
    const own = new Set(p.options.map((o) => o.id));
    if (ids.some((id) => !own.has(id))) throw badRequest(STALE);
  }
  for (const p of onboarding.prompts) {
    const picks = new Set(answers[p.id] ?? []);
    if (p.required && picks.size === 0) throw badRequest(`answers: Answer “${p.title}”`);
    if (p.singleSelect && picks.size > 1)
      throw badRequest(`answers: Pick one answer for “${p.title}”`);
  }
  return answersOf(onboarding, Object.values(answers).flat());
}

/** The roles the options hand out (only `grantable` ones: roles of the Space, not @everyone). */
function rolesOfOptions(
  onboarding: SpaceOnboarding,
  optionIds: ReadonlySet<string>,
  grantable: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const p of onboarding.prompts)
    for (const o of p.options)
      if (optionIds.has(o.id)) for (const r of o.roleIds) if (grantable.has(r)) out.add(r);
  return out;
}

/**
 * What changing my answers does to my roles (Channels & Roles). The rule:
 * - every role of an option I pick now is added (when I lack it), as in onboarding: the roles
 *   were checked against the hierarchy when the questions were saved;
 * - a role is removed only when an option I picked before (my saved answers) hands it out, I
 *   no longer pick that option, no option I pick now hands it out, and I hold it.
 * Roles no option of my saved answers hands out are never touched (moderators' grants, other
 * features, picks from before answers were saved); option ids are unique across questions.
 */
export function answerRoleChanges(
  onboarding: SpaceOnboarding,
  previous: OnboardingAnswers | null | undefined,
  next: OnboardingAnswers,
  held: readonly string[],
  grantable: ReadonlySet<string>,
): { added: string[]; removed: string[] } {
  const now = new Set(Object.values(next).flat());
  const before = new Set(Object.values(previous ?? {}).flat());
  const kept = rolesOfOptions(onboarding, now, grantable);
  const unpicked = new Set([...before].filter((id) => !now.has(id)));
  const dropped = rolesOfOptions(onboarding, unpicked, grantable);
  const mine = new Set(held);
  return {
    added: [...kept].filter((r) => !mine.has(r)),
    removed: [...dropped].filter((r) => mine.has(r) && !kept.has(r)),
  };
}
