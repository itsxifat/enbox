/**
 * `#{id}` channel mentions: parsed anywhere in the markdown (raw in code, escapable), shown as
 * a "#name" pill with the channel type's icon that opens the channel (threads and posts beside
 * their parent), "#unknown" for a channel I can't see.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Hash, MessageSquare, MessagesSquare, Volume2 } from 'lucide-react';
import { renderMentions, type ChatSummary } from '@enbox/shared';
import { bus } from '@/lib/bus';
import { resetSessionState } from '@/lib/session';
import { useChats } from '@/stores/chats';
import { makeChat } from '@/test/factories';
import { RichText } from '../bubbles/RichText';
import { inlineToPlain, parseMarkdown, parseRichText } from '../lib/richText';
import { channelMentionName } from './names';
import { channelMentionTarget } from './target';

const ID = '0f8f5c1e-2a4b-4c6d-8e9f-0123456789ab';
const TOKEN = `#{${ID}}`;
const space: NonNullable<ChatSummary['space']> = {
  spaceId: 's1',
  categoryId: null,
  position: 0,
  topic: null,
  slowmodeSeconds: 0,
  nsfw: false,
  userLimit: null,
  bitrate: null,
  permissionsSynced: true,
  overwrites: [],
};
const general = makeChat({ id: ID, type: 'space_text', name: 'general', space });

afterEach(() => {
  vi.restoreAllMocks();
  resetSessionState();
});

describe('parsing', () => {
  it('finds channel tokens, also inside formatting', () => {
    expect(parseRichText(`see ${TOKEN}!`)).toEqual([
      { t: 'text', text: 'see ' },
      { t: 'channel', chatId: ID },
      { t: 'text', text: '!' },
    ]);
    expect(parseRichText(`**${TOKEN}**`)[0]).toMatchObject({
      t: 'bold',
      children: [{ t: 'channel', chatId: ID }],
    });
    expect(inlineToPlain(parseRichText(`in ${TOKEN}`), () => 'x', () => 'general')).toBe('in #general');
  });

  it('code shows the raw token; an escaped token is text', () => {
    expect(parseRichText(`\`${TOKEN}\``)).toEqual([{ t: 'code', children: [{ t: 'text', text: TOKEN }] }]);
    expect(parseMarkdown(`\`\`\`\n${TOKEN}\n\`\`\``)).toEqual([{ b: 'code', lang: null, code: TOKEN }]);
    expect(parseRichText(`\\${TOKEN}`)).toEqual([{ t: 'text', text: TOKEN }]);
  });
});

describe('channelMentionTarget', () => {
  it('names the channel, picks its icon and where it opens', () => {
    expect(channelMentionTarget(general)).toEqual({ name: 'general', icon: Hash, path: `/spaces/s1/${ID}` });
    expect(channelMentionTarget({ ...general, type: 'space_voice', name: 'Lounge' })?.icon).toBe(Volume2);
    const thread = {
      ...general,
      id: 't1',
      type: 'space_thread' as const,
      name: 'Plans',
      thread: {
        parentId: 'p1',
        starterMessageId: null,
        ownerId: null,
        archived: false,
        locked: false,
        autoArchiveMinutes: 1440,
        messageCount: 0,
      },
    };
    expect(channelMentionTarget(thread)).toEqual({
      name: 'Plans',
      icon: MessagesSquare,
      path: '/spaces/s1/p1?thread=t1',
    });
    expect(channelMentionTarget(thread, { type: 'space_forum' })?.icon).toBe(MessageSquare);
  });

  it('nothing for an unknown chat or one that is not a Space channel', () => {
    expect(channelMentionTarget(undefined)).toBeNull();
    expect(channelMentionTarget(makeChat({ id: 'g1', type: 'group', name: 'Book club' }))).toBeNull();
  });

  it('as plain text (quotes, snippets, copy): the name, else unknown', () => {
    useChats.setState({ byId: { [ID]: general } });
    expect(renderMentions(`in ${TOKEN}`, () => 'x', undefined, channelMentionName)).toBe('in #general');
    useChats.setState({ byId: {} });
    expect(renderMentions(`in ${TOKEN}`, () => 'x', undefined, channelMentionName)).toBe('in #unknown');
  });
});

describe('the pill', () => {
  it('opens the channel in-app', () => {
    useChats.setState({ byId: { [ID]: general } });
    const emit = vi.spyOn(bus, 'emit');
    render(<RichText text={`go to ${TOKEN}`} />);
    const link = screen.getByRole('link', { name: 'general' });
    expect(link).toHaveAttribute('href', `/spaces/s1/${ID}`);
    fireEvent.click(link);
    expect(emit).toHaveBeenCalledWith('navigate', { to: `/spaces/s1/${ID}` });
  });

  it('a channel I can’t see is #unknown, not a link', () => {
    useChats.setState({ byId: {} });
    const { container } = render(<RichText text={`go to ${TOKEN}`} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelector('[data-channel-mention="unknown"]')).toHaveTextContent('unknown');
  });
});
