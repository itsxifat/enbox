import { describe, expect, it } from 'vitest';
import { channelLabel, routePlace } from './place';

describe('routePlace', () => {
  it('Space channels, Space pages and the Space itself', () => {
    expect(routePlace('/spaces/s1/c1')).toEqual({ kind: 'channel', spaceId: 's1', chatId: 'c1' });
    expect(routePlace('/spaces/s1')).toEqual({ kind: 'space', spaceId: 's1', page: null });
    expect(routePlace('/spaces/s1/guide')).toEqual({ kind: 'space', spaceId: 's1', page: 'Server Guide' });
    expect(routePlace('/spaces/s1/settings/roles')).toEqual({ kind: 'space', spaceId: 's1', page: 'Server Settings' });
    expect(routePlace('/spaces')).toEqual({ kind: 'page', title: 'Spaces' });
  });

  it('conversations under any list, and channels under Updates', () => {
    expect(routePlace('/chats/d1')).toEqual({ kind: 'chat', chatId: 'd1' });
    expect(routePlace('/starred/d1')).toEqual({ kind: 'chat', chatId: 'd1' });
    expect(routePlace('/updates/channels/n1')).toEqual({ kind: 'chat', chatId: 'n1' });
    expect(routePlace('/updates/channels/discover')).toEqual({ kind: 'page', title: 'Updates' });
  });

  it('the app pages: Home is Friends', () => {
    expect(routePlace('/chats')).toEqual({ kind: 'page', title: 'Friends' });
    expect(routePlace('/message-requests')).toEqual({ kind: 'page', title: 'Message Requests' });
    expect(routePlace('/discover')).toEqual({ kind: 'page', title: 'Explore Spaces' });
    expect(routePlace('/preview/s9')).toEqual({ kind: 'page', title: 'Explore Spaces' });
    expect(routePlace('/new/group')).toEqual({ kind: 'page', title: 'New Group' });
    expect(routePlace('/settings/help')).toEqual({ kind: 'page', title: 'User Settings' });
    expect(routePlace('/nowhere')).toBeNull();
  });
});

describe('channelLabel', () => {
  it('text-like channels get #; voice and Stage channels read plain', () => {
    expect(channelLabel({ type: 'space_text', name: 'general' })).toBe('#general');
    expect(channelLabel({ type: 'space_forum', name: 'help' })).toBe('#help');
    expect(channelLabel({ type: 'space_voice', name: 'Lounge' })).toBe('Lounge');
    expect(channelLabel({ type: 'space_stage', name: 'Town Hall' })).toBe('Town Hall');
  });
});
