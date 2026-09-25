import { describe, expect, it } from 'vitest';
import { computeChatPermissions, type ChatSummary } from '@enbox/shared';
import { makeChat, makeMessage } from '@/test/factories';
import { chatPath } from '@/features/chats/links';
import { canMessageSender, canReply, canReplyPrivately } from './actions';

const ME = 'me';
function chat(p: Partial<ChatSummary>): ChatSummary {
  const c = makeChat(p);
  return { ...c, permissions: computeChatPermissions(c, ME) };
}
const live = { deleted: false, member: true };

describe('canReply', () => {
  it('offers Reply on normal messages in chats I can write to', () => {
    expect(canReply(chat({ type: 'group' }), makeMessage({ senderId: 'bob' }))).toBe(true);
  });

  it('never on call or system messages (the server refuses those replies)', () => {
    const g = chat({ type: 'direct' });
    expect(canReply(g, makeMessage({ type: 'call', text: null }))).toBe(false);
    expect(canReply(g, makeMessage({ type: 'system', text: null }))).toBe(false);
  });

  it('never when I can no longer write', () => {
    expect(canReply(chat({ type: 'group', membership: 'left' }), makeMessage())).toBe(false);
  });
});

describe('private replies from a group message', () => {
  const g = chat({ type: 'group' });
  const m = makeMessage({ senderId: 'bob' });

  it('offers both actions for an active sender', () => {
    expect(canReplyPrivately(g, m, ME, live)).toBe(true);
    expect(canMessageSender(g, m, ME, live)).toBe(true);
  });

  it('hides Reply privately for former members (me or the sender)', () => {
    expect(canReplyPrivately(chat({ type: 'group', membership: 'left' }), m, ME, live)).toBe(false);
    expect(canReplyPrivately(g, m, ME, { deleted: false, member: false })).toBe(false);
    // Unknown member list: allowed (the server has the final word).
    expect(canReplyPrivately(g, m, ME, { deleted: false, member: null })).toBe(true);
  });

  it('hides both for a deleted account and for my own messages', () => {
    const deleted = { deleted: true, member: null };
    expect(canReplyPrivately(g, m, ME, deleted)).toBe(false);
    expect(canMessageSender(g, m, ME, deleted)).toBe(false);
    expect(canMessageSender(g, makeMessage({ senderId: ME }), ME, live)).toBe(false);
  });
});

describe('chatPath', () => {
  it('opens channels in their feed and other chats in the conversation view', () => {
    expect(chatPath({ id: 'c1', type: 'channel' }, { seq: 4, messageId: 'm' })).toBe(
      '/updates/channels/c1?m=4&mid=m',
    );
    expect(chatPath({ id: 'g1', type: 'group' }, { seq: 4, base: '/starred' })).toBe(
      '/starred/g1?m=4',
    );
    expect(chatPath({ id: 'd1', type: 'direct' })).toBe('/chats/d1');
  });
});
