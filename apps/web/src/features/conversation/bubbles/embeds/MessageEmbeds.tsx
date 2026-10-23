/**
 * The rich embeds of a message (`Message.embeds`, at most EMBED_LIMITS.perMessage), under its
 * text. Messages without any, or with their embeds removed (SUPPRESS_EMBEDS), render nothing.
 */
import { EMBED_LIMITS, MESSAGE_FLAGS, hasMessageFlag, type Message } from '@enbox/shared';
import { RichEmbed } from './RichEmbed';

export function MessageEmbeds({ m }: { m: Pick<Message, 'embeds' | 'deletedAt' | 'flags'> }) {
  if (m.deletedAt || !m.embeds?.length) return null;
  if (hasMessageFlag(m.flags, MESSAGE_FLAGS.SUPPRESS_EMBEDS)) return null;
  return (
    <div className="flex min-w-0 flex-col" data-testid="message-embeds">
      {m.embeds.slice(0, EMBED_LIMITS.perMessage).map((embed, i) => (
        <RichEmbed key={i} embed={embed} />
      ))}
    </div>
  );
}
