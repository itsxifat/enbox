/**
 * Contracts of the Server Guide, Browse Channels and Channels & Roles
 * (docs/design/discord-parity.md W12-B): a welcome sign with to-dos and resources, opt-in
 * channels members choose to show, and onboarding answers members can change later.
 */
import { z } from 'zod';
import type { ID } from './models.js';
import { idSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Server Guide
// ---------------------------------------------------------------------------

export const GUIDE_MAX_TODOS = 5;
export const GUIDE_MAX_RESOURCES = 7;

export interface GuideTodo {
  /** A channel visible to @everyone; visiting it ticks the to-do. */
  channelId: ID;
  emoji: string | null;
  description: string;
}

export interface GuideResource {
  channelId: ID;
  title: string;
  description: string | null;
  emoji: string | null;
}

/** `Space.guide` (null = no guide). */
export interface ServerGuide {
  enabled: boolean;
  welcome: { title: string; subtitle: string | null };
  todos: GuideTodo[];
  resources: GuideResource[];
}

/** `PUT /api/spaces/:spaceId/guide` (MANAGE_SPACE): the whole guide, or null to remove it. */
export const serverGuideSchema = z
  .object({
    enabled: z.boolean(),
    welcome: z.object({
      title: z.string().trim().min(1).max(100),
      subtitle: z.string().trim().max(300).nullable(),
    }),
    todos: z
      .array(
        z.object({
          channelId: idSchema,
          emoji: z.string().trim().max(80).nullable(),
          description: z.string().trim().min(1).max(100),
        }),
      )
      .max(GUIDE_MAX_TODOS),
    resources: z
      .array(
        z.object({
          channelId: idSchema,
          title: z.string().trim().min(1).max(60),
          description: z.string().trim().max(200).nullable(),
          emoji: z.string().trim().max(80).nullable(),
        }),
      )
      .max(GUIDE_MAX_RESOURCES),
  })
  .nullable();
export type ServerGuideRequest = z.input<typeof serverGuideSchema>;

/** `POST /api/spaces/:spaceId/guide/todos/:channelId/done`: I did that to-do (idempotent). */
export interface GuideProgress {
  doneChannelIds: ID[];
}

// ---------------------------------------------------------------------------
// Browse Channels (opt-in channels)
// ---------------------------------------------------------------------------

/**
 * `SpaceChannelInfo.optIn`: hidden from members' sidebars until they choose to show it in
 * Browse Channels. My choices override the default per channel.
 */
export interface ChannelPref {
  channelId: ID;
  /** Shown in my sidebar (false hides a default channel; true shows an opt-in one). */
  shown: boolean;
}

/** `PUT /api/spaces/:spaceId/channel-prefs`: my choices (a batch, up to 200 channels). */
export const channelPrefsSchema = z.object({
  prefs: z
    .array(z.object({ channelId: idSchema, shown: z.boolean() }))
    .min(1)
    .max(200),
});
export type ChannelPrefsRequest = z.input<typeof channelPrefsSchema>;

// ---------------------------------------------------------------------------
// Channels & Roles (change my onboarding answers)
// ---------------------------------------------------------------------------

/** My answers: prompt id → chosen option ids (`SpaceMemberSelf.onboardingAnswers`). */
export type OnboardingAnswers = Record<ID, ID[]>;
