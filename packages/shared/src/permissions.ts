/**
 * Space permissions (docs/design/spaces-at-scale.md "Permissions"): a 31-flag bitfield in an
 * int4 (bit 31 is never used, so values stay non-negative JS numbers) evaluated with
 * Discord's algorithm. Pure: the server and every client MUST use these helpers.
 *
 *   base = owner ? ALL : @everyone | member roles;   ADMINISTRATOR → ALL
 *   channel = base, then overwrites: @everyone → member's roles (OR deny, OR allow) → member
 *   no VIEW_CHANNEL → 0; text channels drop voice bits, voice channels drop text-only bits;
 *   a timed-out member (not owner/administrator) keeps only VIEW_CHANNEL and
 *   READ_MESSAGE_HISTORY (Discord's rule: no sending, reacting, voice or moderation).
 *
 * One deviation: IMPLICIT_PERMISSIONS (USE_EXTERNAL_EMOJI) are in every member's base,
 * whatever their roles ("allowed when unset"). The bit was reserved until custom emoji, so no
 * existing role carries it, and roles are not rewritten; a channel overwrite can still deny
 * it (and allow it back for a role or member).
 *
 * Category overwrites are templates (copied to a channel on create / sync), never evaluated.
 */
import type { ID } from './models.js';

export const PERM = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  EMBED_LINKS: 1 << 2,
  ATTACH_FILES: 1 << 3,
  ADD_REACTIONS: 1 << 4,
  USE_EXTERNAL_EMOJI: 1 << 5,
  MENTION_EVERYONE: 1 << 6,
  MANAGE_MESSAGES: 1 << 7,
  READ_MESSAGE_HISTORY: 1 << 8,
  SEND_POLLS: 1 << 9,
  CREATE_INVITE: 1 << 10,
  CHANGE_NICKNAME: 1 << 11,
  MANAGE_NICKNAMES: 1 << 12,
  KICK_MEMBERS: 1 << 13,
  BAN_MEMBERS: 1 << 14,
  /** Time members out. */
  MODERATE_MEMBERS: 1 << 15,
  MANAGE_CHANNELS: 1 << 16,
  MANAGE_ROLES: 1 << 17,
  MANAGE_SPACE: 1 << 18,
  VIEW_AUDIT_LOG: 1 << 19,
  MANAGE_WEBHOOKS: 1 << 20,
  MANAGE_EMOJI: 1 << 21,
  CONNECT: 1 << 22,
  SPEAK: 1 << 23,
  VIDEO: 1 << 24,
  STREAM: 1 << 25,
  MUTE_MEMBERS: 1 << 26,
  DEAFEN_MEMBERS: 1 << 27,
  MOVE_MEMBERS: 1 << 28,
  PRIORITY_SPEAKER: 1 << 29,
  ADMINISTRATOR: 1 << 30,
} as const;

export type PermissionName = keyof typeof PERM;

/** Every flag (0x7fffffff). */
export const ALL_PERMISSIONS = 0x7fffffff;

/** Defined but not implemented yet (P4): hidden in editors, rejected by `permissionsSchema`. */
export const RESERVED_PERMISSIONS =
  PERM.EMBED_LINKS | PERM.READ_MESSAGE_HISTORY | PERM.MANAGE_WEBHOOKS | PERM.PRIORITY_SPEAKER;

/**
 * Bits every member's base holds whatever their roles (see the header): roles cannot take
 * them away, channel overwrites can. Editors show them in channel permissions only.
 */
export const IMPLICIT_PERMISSIONS = PERM.USE_EXTERNAL_EMOJI;

/** Bits a role or overwrite may carry. */
export const ASSIGNABLE_PERMISSIONS = ALL_PERMISSIONS & ~RESERVED_PERMISSIONS;

/** Bits that only mean something in voice channels. */
export const VOICE_PERMISSIONS =
  PERM.CONNECT |
  PERM.SPEAK |
  PERM.VIDEO |
  PERM.STREAM |
  PERM.MUTE_MEMBERS |
  PERM.DEAFEN_MEMBERS |
  PERM.MOVE_MEMBERS |
  PERM.PRIORITY_SPEAKER;

/** Bits that only mean something in text channels. */
export const TEXT_ONLY_PERMISSIONS =
  PERM.SEND_MESSAGES |
  PERM.EMBED_LINKS |
  PERM.ATTACH_FILES |
  PERM.ADD_REACTIONS |
  PERM.USE_EXTERNAL_EMOJI |
  PERM.MENTION_EVERYONE |
  PERM.MANAGE_MESSAGES |
  PERM.READ_MESSAGE_HISTORY |
  PERM.SEND_POLLS;

/** Space-wide bits that a channel overwrite cannot grant (they are evaluated on the base). */
export const SPACE_ONLY_PERMISSIONS =
  PERM.CHANGE_NICKNAME |
  PERM.MANAGE_NICKNAMES |
  PERM.KICK_MEMBERS |
  PERM.BAN_MEMBERS |
  PERM.MODERATE_MEMBERS |
  PERM.MANAGE_SPACE |
  PERM.VIEW_AUDIT_LOG |
  PERM.MANAGE_EMOJI |
  PERM.ADMINISTRATOR;

/** What a timed-out member keeps in a channel. */
const TIMED_OUT_KEEP = PERM.VIEW_CHANNEL | PERM.READ_MESSAGE_HISTORY;

/** @everyone of a new Space (USE_EXTERNAL_EMOJI as in Discord; it is implicit anyway). */
export const DEFAULT_EVERYONE_PERMISSIONS =
  PERM.VIEW_CHANNEL |
  PERM.SEND_MESSAGES |
  PERM.ATTACH_FILES |
  PERM.ADD_REACTIONS |
  PERM.USE_EXTERNAL_EMOJI |
  PERM.SEND_POLLS |
  PERM.CREATE_INVITE |
  PERM.CHANGE_NICKNAME |
  PERM.CONNECT |
  PERM.SPEAK |
  PERM.VIDEO |
  PERM.STREAM;

export function hasPerm(bits: number | null | undefined, perm: number): boolean {
  return !!bits && (bits & perm) === perm;
}

export function hasAnyPerm(bits: number | null | undefined, perms: number): boolean {
  return !!bits && (bits & perms) !== 0;
}

/** Names of the bits set in `bits` (audit log, debugging). */
export function permissionNames(bits: number): PermissionName[] {
  return (Object.keys(PERM) as PermissionName[]).filter((k) => (bits & PERM[k]) !== 0);
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface RoleInput {
  id: ID;
  permissions: number;
  position: number;
}

export interface OverwriteInput {
  targetType: 'role' | 'member';
  targetId: ID;
  allow: number;
  deny: number;
}

export interface BaseInput {
  ownerId: ID;
  viewerId: ID;
  /** The Space's @everyone role id. */
  everyoneRoleId: ID;
  /** Every role of the Space (or at least @everyone and the viewer's roles). */
  roles: readonly RoleInput[];
  /** The viewer's roles (without @everyone). */
  memberRoleIds: readonly ID[];
}

/** Space-wide permissions of a member (no channel overwrites; IMPLICIT_PERMISSIONS included). */
export function computeBasePermissions(input: BaseInput): number {
  if (input.viewerId === input.ownerId) return ALL_PERMISSIONS;
  const byId = new Map(input.roles.map((r) => [r.id, r]));
  let bits = byId.get(input.everyoneRoleId)?.permissions ?? 0;
  for (const id of input.memberRoleIds) bits |= byId.get(id)?.permissions ?? 0;
  if (bits & PERM.ADMINISTRATOR) return ALL_PERMISSIONS;
  return (bits | IMPLICIT_PERMISSIONS) & ALL_PERMISSIONS;
}

export interface ChannelInput {
  /** A thread is computed like its parent text channel (pass the parent's overwrites). */
  channelType: 'space_text' | 'space_voice' | 'space_thread' | 'space_forum';
  overwrites: readonly OverwriteInput[];
  everyoneRoleId: ID;
  memberRoleIds: readonly ID[];
  viewerId: ID;
  /** `space_members.timed_out_until` is in the future. */
  timedOut?: boolean;
}

/** A member's permissions in one channel, from their base permissions. */
export function computeChannelPermissions(base: number, input: ChannelInput): number {
  if (base & PERM.ADMINISTRATOR) return ALL_PERMISSIONS & ~channelTypeMask(input.channelType);
  let bits = base;
  let everyone: OverwriteInput | undefined;
  let member: OverwriteInput | undefined;
  let roleAllow = 0;
  let roleDeny = 0;
  const mine = new Set(input.memberRoleIds);
  for (const ow of input.overwrites) {
    if (ow.targetType === 'member') {
      if (ow.targetId === input.viewerId) member = ow;
    } else if (ow.targetId === input.everyoneRoleId) {
      everyone = ow;
    } else if (mine.has(ow.targetId)) {
      roleAllow |= ow.allow;
      roleDeny |= ow.deny;
    }
  }
  const keep = bits & SPACE_ONLY_PERMISSIONS;
  if (everyone) bits = (bits & ~everyone.deny) | everyone.allow;
  bits = (bits & ~roleDeny) | roleAllow;
  if (member) bits = (bits & ~member.deny) | member.allow;
  // Overwrites never change Space-wide bits.
  bits = (bits & ~SPACE_ONLY_PERMISSIONS) | keep;
  if (!(bits & PERM.VIEW_CHANNEL)) return 0;
  bits &= ~channelTypeMask(input.channelType);
  if (input.timedOut) bits &= TIMED_OUT_KEEP;
  return bits & ALL_PERMISSIONS;
}

function channelTypeMask(type: ChannelInput['channelType']): number {
  return type === 'space_voice' ? TEXT_ONLY_PERMISSIONS : VOICE_PERMISSIONS;
}

/** Owner, or ADMINISTRATOR in the base: immune to timeouts and hierarchy limits on bits. */
export function isSpaceAdmin(base: number): boolean {
  return (base & PERM.ADMINISTRATOR) !== 0;
}

/**
 * Convenience: everything at once for one member and channel (`timedOut` applies only when
 * the member is not the owner or an administrator).
 */
export function memberChannelPermissions(
  base: BaseInput,
  channel: Omit<ChannelInput, 'everyoneRoleId' | 'memberRoleIds' | 'viewerId'>,
): number {
  const bits = computeBasePermissions(base);
  return computeChannelPermissions(bits, {
    ...channel,
    everyoneRoleId: base.everyoneRoleId,
    memberRoleIds: base.memberRoleIds,
    viewerId: base.viewerId,
    timedOut: channel.timedOut && !isSpaceAdmin(bits),
  });
}

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

/** Position of a member's highest role (@everyone = 0, the owner = Infinity). */
export function highestRolePosition(
  roles: readonly RoleInput[],
  memberRoleIds: readonly ID[],
  isOwner = false,
): number {
  if (isOwner) return Number.POSITIVE_INFINITY;
  const mine = new Set(memberRoleIds);
  let top = 0;
  for (const r of roles) if (mine.has(r.id) && r.position > top) top = r.position;
  return top;
}

/** An actor may moderate/edit a target only from strictly above (the owner is above everyone). */
export function canActOn(actorTop: number, targetTop: number, targetIsOwner: boolean): boolean {
  if (targetIsOwner) return false;
  return actorTop > targetTop;
}

/** An actor may assign/edit/reorder a role only below their highest role (owner: any). */
export function canManageRole(actorTop: number, rolePosition: number): boolean {
  return rolePosition < actorTop;
}

/**
 * Bits an actor may put into a role or overwrite: anything for administrators, else only
 * bits they have themselves (`actorBits` = their base, or channel bits for overwrites).
 */
export function grantableBits(actorBits: number): number {
  return actorBits & PERM.ADMINISTRATOR
    ? ASSIGNABLE_PERMISSIONS
    : actorBits & ASSIGNABLE_PERMISSIONS;
}
