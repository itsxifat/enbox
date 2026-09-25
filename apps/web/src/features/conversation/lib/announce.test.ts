import { describe, expect, it } from 'vitest';
import { makeChat, makeMessage } from '@/test/factories';
import { incomingAnnouncement } from './announce';

const names: Record<string, string> = { bob: 'Bob', amy: 'Amy' };
const nameOf = (id: string) => names[id] ?? 'Someone';

describe('incomingAnnouncement', () => {
  it('reads a direct message without a sender prefix', () => {
    const chat = makeChat({ type: 'direct' });
    const m = makeMessage({ senderId: 'bob', text: 'Are you coming?' });
    expect(incomingAnnouncement(chat, [m], nameOf, 'me')).toBe('Are you coming?');
  });

  it('prefixes the sender in groups and summarises several messages', () => {
    const chat = makeChat({ type: 'group' });
    const a = makeMessage({ senderId: 'bob', text: 'first' });
    const b = makeMessage({ senderId: 'amy', type: 'image', text: null });
    expect(incomingAnnouncement(chat, [a, b], nameOf, 'me')).toBe('2 new messages. Amy: 📷 Photo');
  });

  it('ignores system messages', () => {
    const chat = makeChat({ type: 'group' });
    const sys = makeMessage({ senderId: null, type: 'system', text: null });
    expect(incomingAnnouncement(chat, [sys], nameOf, 'me')).toBeNull();
  });
});
