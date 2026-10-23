/**
 * Contracts of the "voice social" wave (docs/design/discord-parity.md W9-A, W9-E, W12-C): Active
 * Now (friends in voice), Go Live stream presets, and previewing a Space before joining.
 */
import type { ID, ISODate, Message, SpaceChannelType } from './models.js';

// ---------------------------------------------------------------------------
// Active Now
// ---------------------------------------------------------------------------

/** A voice or Stage channel with friends of mine in it (channels I can see only). */
export interface FriendActivity {
  spaceId: ID;
  spaceName: string;
  spaceIconUrl: string | null;
  channelId: ID;
  channelName: string;
  channelType: Extract<SpaceChannelType, 'space_voice' | 'space_stage'>;
  /** My friends there, longest there first. */
  friendIds: ID[];
  /** Everyone there (first 8, friends first) and how many in all. */
  participantIds: ID[];
  participantCount: number;
  /** Someone there is sharing their screen. */
  streaming: boolean;
  since: ISODate;
}

// ---------------------------------------------------------------------------
// Go Live
// ---------------------------------------------------------------------------

/** Screen share capture presets (Discord: 720p30, 1080p30, 1080p60; "source" is the screen's). */
export const STREAM_PRESETS = {
  '720p30': { width: 1280, height: 720, fps: 30, maxBitrate: 2_500_000 },
  '1080p30': { width: 1920, height: 1080, fps: 30, maxBitrate: 4_500_000 },
  '1080p60': { width: 1920, height: 1080, fps: 60, maxBitrate: 7_000_000 },
} as const;
export type StreamPreset = keyof typeof STREAM_PRESETS;

// ---------------------------------------------------------------------------
// Space preview (lurk before joining)
// ---------------------------------------------------------------------------

/** `GET /api/spaces/:spaceId/preview`: a discoverable Space as a non-member sees it. */
export interface SpacePreview {
  id: ID;
  name: string;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  memberCount: number;
  onlineCount: number;
  /** Text and announcement channels @everyone can read, in sidebar order. */
  channels: {
    id: ID;
    name: string;
    topic: string | null;
    categoryName: string | null;
    isNews: boolean;
  }[];
}

/** `GET /api/spaces/:spaceId/preview/channels/:channelId/messages`: the latest messages. */
export interface SpacePreviewMessages {
  messages: Message[];
}
