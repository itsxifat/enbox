/**
 * Contracts of the expressions and security wave (docs/design/discord-parity.md W6-B/D, W9,
 * W7-E, W13): stickers, messages with up to 10 attachments and alt text, Stage channels and
 * the soundboard, group DMs, and two-factor sign-in. All additive: a sticker message is an
 * `image` message whose media is the sticker (old clients show the picture), and a message's
 * first attachment stays `Message.media`.
 */
import { z } from 'zod';
import type { ID, ISODate, MediaAttachment } from './models.js';
import { idSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/** Files per message (Discord: 10). */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_ALT_TEXT_LENGTH = 1024;

/** One attachment of a message (`Message.attachments`, in order; [0] is `Message.media`). */
export interface MessageAttachment extends MediaAttachment {
  /** Alt text; null when none. */
  description: string | null;
}

// ---------------------------------------------------------------------------
// Stickers
// ---------------------------------------------------------------------------

/** Free for every Space. */
export const SPACE_STICKER_LIMIT = 60;
export const MAX_STICKER_BYTES = 512 * 1024;
export const STICKER_NAME_MAX_LENGTH = 30;

export interface SpaceSticker {
  id: ID;
  spaceId: ID;
  name: string;
  description: string | null;
  /** The related emoji (suggestions, screen readers). */
  emoji: string | null;
  url: string;
  animated: boolean;
  createdBy: ID | null;
}

/** `Message.sticker` of a sticker message. */
export interface MessageStickerRef {
  id: ID;
  name: string;
  spaceId: ID | null;
}

export interface SpaceStickerGroup {
  spaceId: ID;
  spaceName: string;
  iconUrl: string | null;
  stickers: SpaceSticker[];
}

export const createSpaceStickerSchema = z.object({
  name: z.string().trim().min(2).max(STICKER_NAME_MAX_LENGTH),
  description: z.string().trim().max(100).nullable().optional(),
  emoji: z.string().trim().max(80).nullable().optional(),
  /** An image I uploaded (PNG, APNG, WebP or GIF, ≤ MAX_STICKER_BYTES). */
  mediaId: idSchema,
});
export const updateSpaceStickerSchema = createSpaceStickerSchema.omit({ mediaId: true }).partial();
export type CreateSpaceStickerRequest = z.input<typeof createSpaceStickerSchema>;
export type UpdateSpaceStickerRequest = z.input<typeof updateSpaceStickerSchema>;

// ---------------------------------------------------------------------------
// Stage channels and the soundboard
// ---------------------------------------------------------------------------

/** Free for every Space. */
export const SPACE_SOUND_LIMIT = 48;
export const MAX_SOUND_BYTES = 512 * 1024;
/** Longest soundboard clip. */
export const MAX_SOUND_DURATION_MS = 5_200;

export interface SpaceSound {
  id: ID;
  spaceId: ID;
  name: string;
  emoji: string | null;
  /** 0..1. */
  volume: number;
  url: string;
  createdBy: ID | null;
}

export const createSpaceSoundSchema = z.object({
  name: z.string().trim().min(2).max(32),
  emoji: z.string().trim().max(80).nullable().optional(),
  volume: z.number().min(0).max(1).default(1),
  /** An audio file I uploaded (MP3, OGG or WAV, ≤ MAX_SOUND_BYTES, ≤ MAX_SOUND_DURATION_MS). */
  mediaId: idSchema,
});
export const updateSpaceSoundSchema = createSpaceSoundSchema.omit({ mediaId: true }).partial();
export type CreateSpaceSoundRequest = z.input<typeof createSpaceSoundSchema>;
export type UpdateSpaceSoundRequest = z.input<typeof updateSpaceSoundSchema>;

/** `voice:sound`: someone in the channel played a sound (everyone there plays it locally). */
export interface VoiceSoundEvent {
  spaceId: ID;
  channelId: ID;
  userId: ID;
  sound: SpaceSound;
}

/** Stage: raise or lower my hand; moderators move speakers to and from the audience. */
export const stageRequestSchema = z.object({ requestToSpeak: z.boolean() });
export const stageSpeakerSchema = z.object({ suppressed: z.boolean() });
export type StageRequest = z.input<typeof stageRequestSchema>;
export type StageSpeakerRequest = z.input<typeof stageSpeakerSchema>;

// ---------------------------------------------------------------------------
// Group DMs
// ---------------------------------------------------------------------------

/** Members of a group DM, me included (Discord: 10). */
export const GROUP_DM_MAX_MEMBERS = 10;

export const createGroupDmSchema = z.object({
  /** Friends to add (1 → that DM opens instead). */
  userIds: z
    .array(idSchema)
    .min(1)
    .max(GROUP_DM_MAX_MEMBERS - 1),
  name: z.string().trim().max(100).nullable().optional(),
});
export const addGroupDmMembersSchema = z.object({
  userIds: z
    .array(idSchema)
    .min(1)
    .max(GROUP_DM_MAX_MEMBERS - 1),
});
export type CreateGroupDmRequest = z.input<typeof createGroupDmSchema>;
export type AddGroupDmMembersRequest = z.input<typeof addGroupDmMembersSchema>;

// ---------------------------------------------------------------------------
// Two-factor sign-in (TOTP, RFC 6238) and backup codes
// ---------------------------------------------------------------------------

export const BACKUP_CODE_COUNT = 10;

/** `POST /api/me/mfa/totp/setup`: a new secret to scan (not active until confirmed). */
export interface TotpSetup {
  secret: string;
  /** `otpauth://totp/Enbox:<username>?secret=…&issuer=Enbox` for authenticator apps. */
  otpauthUrl: string;
}

export interface BackupCodes {
  codes: string[];
}

/** `POST /api/auth/login` with two-factor on: no session yet, a short-lived ticket instead. */
export interface MfaChallenge {
  mfaRequired: true;
  ticket: string;
  /** When the ticket expires. */
  expiresAt: ISODate;
}

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const backupCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]{4}-?[a-z0-9]{4}$/, 'Enter a backup code');

export const enableTotpSchema = z.object({ code: totpCodeSchema });
export const disableTotpSchema = z.object({ code: z.union([totpCodeSchema, backupCodeSchema]) });
export const regenerateBackupCodesSchema = z.object({ password: z.string().min(1).max(256) });
export const loginMfaSchema = z.object({
  ticket: z.string().min(10).max(2000),
  /** A TOTP code or an unused backup code. */
  code: z.union([totpCodeSchema, backupCodeSchema]),
});
export type EnableTotpRequest = z.input<typeof enableTotpSchema>;
export type DisableTotpRequest = z.input<typeof disableTotpSchema>;
export type RegenerateBackupCodesRequest = z.input<typeof regenerateBackupCodesSchema>;
export type LoginMfaRequest = z.input<typeof loginMfaSchema>;
