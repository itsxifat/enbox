import type {
  CallMessagePayload,
  ContactCardPayload,
  LocationPayload,
  MessagePreview,
  StatusReplyPayload,
  SystemEvent,
} from '@enbox/shared';

/** Poll definition stored on the message; votes live in `poll_votes`. */
export interface PollDefinition {
  question: string;
  options: { id: string; text: string }[];
  allowMultiple: boolean;
}

/**
 * Type-specific content stored in `messages.metadata` (jsonb). Only the key matching the
 * message type is set, plus `replyPreview` when the message is a reply (a snapshot taken at
 * send time so quotes survive the original being deleted-for-me or expiring).
 */
export interface MessageMetadata {
  location?: LocationPayload;
  contact?: ContactCardPayload;
  poll?: PollDefinition;
  system?: SystemEvent;
  call?: CallMessagePayload;
  statusReply?: StatusReplyPayload;
  replyPreview?: MessagePreview;
}
