import type {
  CallMessagePayload,
  ContactCardPayload,
  ID,
  LocationPayload,
  StatusType,
  SystemEvent,
} from '@enbox/shared';

/** Poll definition stored on the message; votes live in `poll_votes`. */
export interface PollDefinition {
  question: string;
  options: { id: string; text: string }[];
  allowMultiple: boolean;
}

/**
 * Minimal reference to the status a message replies to. The rest of `StatusReplyPayload`
 * (text, colors, media) is resolved at read time while the status still exists; after it is
 * deleted/expired the payload is `available: false` (no content is copied into messages).
 */
export interface StoredStatusReply {
  statusId: ID;
  authorId: ID;
  type: StatusType;
}

/**
 * Type-specific content stored in `messages.metadata` (jsonb). Only the key matching the
 * message type is set, plus `statusReply` for status replies. Reply quotes are NOT stored:
 * they are computed at read time from `reply_to_id`. Delete-for-everyone clears every key.
 */
export interface MessageMetadata {
  location?: LocationPayload;
  contact?: ContactCardPayload;
  poll?: PollDefinition;
  system?: SystemEvent;
  call?: CallMessagePayload;
  statusReply?: StoredStatusReply;
}

/**
 * Timestamps selected through raw SQL (`db.execute`, untyped `sql` selections) come back as
 * driver strings (e.g. '2026-09-25 08:28:22.883+00'); always convert them for the wire.
 */
export function toIso(value: string | Date | null | undefined): string | null {
  return value == null ? null : new Date(value).toISOString();
}
