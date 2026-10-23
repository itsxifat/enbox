/** Space Settings → AutoMod: the four cards over the saved rules, editing keywords (n/1000), the timeout chips, alerts, the switch. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AutoModRule, ChatSummary, SpaceRole } from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeChat, makeMe } from '@/test/factories';
import { bodyOf, draftOf, parseWords } from '../automod/rules';
import { makeSpace } from '../testUtils';
import { AutoModPage } from './AutoModPage';

const trusted: SpaceRole = {
  id: 'trusted',
  name: 'Trusted',
  color: '#3498db',
  position: 1,
  permissions: 0,
  hoist: false,
  mentionable: false,
  isDefault: false,
};
const base = makeSpace({ owner: true });
const space = { ...base, roles: [...base.roles, trusted] };

function channel(id: string, name: string): ChatSummary {
  return {
    ...makeChat({ id, name, type: 'space_text' }),
    space: {
      spaceId: 's1',
      categoryId: null,
      position: id === 'general' ? 0 : 1,
      topic: null,
      slowmodeSeconds: 0,
      nsfw: false,
      userLimit: null,
      bitrate: null,
      permissionsSynced: true,
      overwrites: [],
    },
  };
}

const words: AutoModRule = {
  id: 'r1',
  spaceId: 's1',
  name: 'Custom Words',
  triggerType: 'keyword',
  triggerMetadata: { keywords: ['spoiler', 'leak*'], regexPatterns: [], allowList: [] },
  actions: [{ type: 'block', customMessage: null }],
  enabled: true,
  exemptRoleIds: [],
  exemptChannelIds: [],
  creatorId: 'me',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function setup(rules: AutoModRule[]) {
  useSpaces.setState({ byId: { s1: space }, order: ['s1'], loaded: true, channelsLoaded: { s1: true }, members: {} });
  useChats.setState({ byId: { general: channel('general', 'general'), modlog: channel('modlog', 'mod-log') } });
  const get = vi.spyOn(api, 'get').mockResolvedValue(rules as never);
  const patch = vi
    .spyOn(api, 'patch')
    .mockImplementation(async (_path: string, body?: unknown) => ({ ...words, ...(body as object) }) as never);
  const post = vi
    .spyOn(api, 'post')
    .mockImplementation(async (_path: string, body?: unknown) => ({ ...words, id: 'new', ...(body as object) }) as never);
  render(<AutoModPage space={space} />);
  return { get, patch, post };
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [] });
});

describe('AutoModPage', () => {
  it('shows the four cards over the saved rules', async () => {
    const { get } = setup([words]);
    const custom = await screen.findByTestId('automod-rule-r1');
    expect(get).toHaveBeenCalledWith('/api/spaces/s1/automod/rules');
    for (const title of ['Block Mention Spam', 'Block Suspected Spam Content', 'Block Commonly Flagged Words', 'Block Custom Words'])
      expect(screen.getByText(title)).toBeInTheDocument();
    expect(custom).toHaveTextContent('Custom Words');
    expect(custom).toHaveTextContent('2 words · blocks');
    // Kinds without a rule offer "Set up".
    expect(within(screen.getByTestId('automod-card-mention_spam')).getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Keyword Rule/ })).toBeEnabled();
  });

  it('edits the words: comma or line separated, an n/1000 counter, saved as a list', async () => {
    const { patch } = setup([words]);
    const card = await screen.findByTestId('automod-rule-r1');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    const box = within(card).getByLabelText('Words and phrases');
    expect(box).toHaveValue('spoiler, leak*');
    expect(within(card).getByTestId('automod-keyword-count')).toHaveTextContent('2/1000');
    fireEvent.change(box, { target: { value: 'spoiler, leak*\nfree nitro,, spoiler' } });
    expect(within(card).getByTestId('automod-keyword-count')).toHaveTextContent('3/1000');
    fireEvent.click(within(card).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const [path, body] = patch.mock.calls[0]!;
    expect(path).toBe('/api/spaces/s1/automod/rules/r1');
    expect(body).toMatchObject({ triggerMetadata: { keywords: ['spoiler', 'leak*', 'free nitro'] } });
    expect(body).not.toHaveProperty('triggerType');
    await waitFor(() => expect(within(card).queryByLabelText('Words and phrases')).toBeNull());
    expect(card).toHaveTextContent('3 words · blocks');
  });

  it('timeout chips pick the duration of a new mention spam rule', async () => {
    const { post } = setup([]);
    const card = await screen.findByTestId('automod-card-mention_spam');
    fireEvent.click(within(card).getByRole('button', { name: 'Set up' }));
    fireEvent.click(within(card).getByRole('checkbox', { name: /^Timeout member/ }));
    const chips = within(card).getByRole('radiogroup', { name: 'Timeout duration' });
    expect(within(chips).getAllByRole('radio').map((c) => c.textContent)).toEqual([
      '60 secs',
      '5 mins',
      '10 mins',
      '1 hour',
      '1 day',
      '1 week',
    ]);
    expect(within(chips).getByRole('radio', { name: '60 secs' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(chips).getByRole('radio', { name: '5 mins' }));
    expect(within(chips).getByRole('radio', { name: '5 mins' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(card).getByRole('button', { name: 'Create Rule' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![1]).toEqual({
      name: 'Mention Spam',
      triggerType: 'mention_spam',
      triggerMetadata: { mentionLimit: 20 },
      actions: [
        { type: 'block', customMessage: null },
        { type: 'timeout', durationSeconds: 300 },
      ],
      enabled: true,
      exemptRoleIds: [],
      exemptChannelIds: [],
    });
  });

  it('an alert needs a channel; exempt roles are toggled', async () => {
    const { patch } = setup([words]);
    const card = await screen.findByTestId('automod-rule-r1');
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    fireEvent.click(within(card).getByRole('checkbox', { name: /^Send an alert/ }));
    fireEvent.click(within(card).getByRole('button', { name: 'Save Changes' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Choose the channel that gets the alerts');
    expect(patch).not.toHaveBeenCalled();
    fireEvent.change(within(card).getByLabelText('Alert channel'), { target: { value: 'modlog' } });
    fireEvent.click(within(within(card).getByRole('group', { name: 'Exempt roles' })).getByRole('button', { name: /Trusted/ }));
    fireEvent.click(within(card).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]![1]).toMatchObject({
      actions: [
        { type: 'block', customMessage: null },
        { type: 'alert', channelId: 'modlog' },
      ],
      exemptRoleIds: ['trusted'],
    });
  });

  it('the switch turns a rule off at once', async () => {
    const { patch } = setup([words]);
    const card = await screen.findByTestId('automod-rule-r1');
    fireEvent.click(within(card).getByRole('switch', { name: 'Custom Words on' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/spaces/s1/automod/rules/r1', { enabled: false }));
    await waitFor(() => expect(within(card).getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
  });
});

describe('AutoMod drafts', () => {
  it('words split on commas and new lines; bodies explain what is missing', () => {
    expect(parseWords(' a, b\nc,,a ')).toEqual(['a', 'b', 'c']);
    const empty = { ...draftOf('keyword'), keywords: '' };
    expect(bodyOf('keyword', empty).error).toBe('Add at least one word or pattern');
    expect(bodyOf('preset', { ...draftOf('preset'), presets: [] }).error).toBe('Choose at least one list');
    expect(bodyOf('spam_links', { ...draftOf('spam_links'), block: false }).error).toBe('Choose at least one response');
    expect(bodyOf('keyword', { ...draftOf('keyword'), keywords: 'x'.repeat(61) }).error).toMatch(/longer than 60/);
    expect(bodyOf('preset', draftOf('preset')).body?.triggerMetadata).toEqual({
      presets: ['profanity', 'sexual', 'slurs'],
      allowList: [],
    });
  });
});
