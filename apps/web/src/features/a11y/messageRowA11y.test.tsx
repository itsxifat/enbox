/** Message rows for screen readers: articles named "<author>, <time>, <content>". */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MessageAttachment, SpaceChannelInfo, SpaceMember } from '@enbox/shared';
import { RowAppearanceContext } from '@/features/conversation/bubbles/appearance';
import { CozyMessageRow } from '@/features/conversation/CozyMessageRow';
import type { Row } from '@/features/conversation/lib/rows';
import { MessageRow } from '@/features/conversation/MessageRow';
import { resetSessionState } from '@/lib/session';
import { formatTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { LABEL_TEXT_MAX, messageContentLabel, messageRowLabel } from './messageRowA11y';

const msg = (p: Partial<ClientMessage> = {}) => makeMessage(p) as ClientMessage;
const ANN = '0f0e0d0c-0b0a-4908-8706-050403020100';
const at = formatTime('2025-03-12T10:42:00.000Z');
const PHOTO = {
  id: 'a1',
  kind: 'image',
  url: '/uploads/cat.jpg',
  description: null,
} as unknown as MessageAttachment;

describe('messageRowLabel', () => {
  it('names the author and the time, then the text', () => {
    expect(messageRowLabel(msg({ text: 'hello there' }), 'Ann', 'hello there', false)).toBe(
      `Ann, ${at}, hello there`,
    );
  });

  it(`keeps the first ${LABEL_TEXT_MAX} characters of a long text`, () => {
    const text = `${'a'.repeat(LABEL_TEXT_MAX)}bbb`;
    expect(messageContentLabel(msg({ text }), text, false)).toBe(`${'a'.repeat(LABEL_TEXT_MAX)}…`);
  });

  it('says what a message without text is', () => {
    expect(messageContentLabel(msg({ type: 'image', text: null }), '', false)).toBe('Image');
    expect(
      messageContentLabel(
        msg({ type: 'image', text: null, attachments: [{ ...PHOTO, description: 'A cat' }] }),
        '',
        false,
      ),
    ).toBe('Image, A cat');
    expect(messageContentLabel(msg({ type: 'image', text: 'Look' }), 'Look', false)).toBe(
      'Image, Look',
    );
    expect(
      messageContentLabel(
        msg({ type: 'image', attachments: [PHOTO, { ...PHOTO, id: 'a2' }] }),
        '',
        false,
      ),
    ).toBe('2 images');
    expect(
      messageContentLabel(
        msg({ type: 'image', text: null, sticker: { id: 's1', name: 'Wave', spaceId: null } }),
        '',
        false,
      ),
    ).toBe('Sticker, Wave');
  });

  it('deleted and failed messages say so', () => {
    const deleted = msg({ text: null, deletedAt: '2025-03-12T10:43:00.000Z' });
    expect(messageContentLabel(deleted, '', true)).toBe('You deleted this message');
    expect(messageContentLabel(deleted, '', false)).toBe('This message was deleted');
    expect(messageRowLabel(msg({ failed: true }), 'Me', 'hello', true)).toBe(
      `Me, ${at}, hello, not sent`,
    );
  });
});

describe('message rows', () => {
  const me = makeMe({ id: 'me', displayName: 'Mia Me' });
  const chat = makeChat({ id: 'g1', type: 'group' });
  const row = (m: ClientMessage, mine: boolean): Row => ({
    key: m.id,
    message: m,
    mine,
    showDay: false,
    unreadDivider: 0,
    firstInGroup: true,
    lastInGroup: true,
  });
  const renderRow = (r: Row, cozy: boolean) =>
    render(
      <RowAppearanceContext.Provider
        value={{ bubbleStyle: cozy ? 'cozy' : 'classic', messageAnimation: 'none' }}
      >
        {cozy ? (
          <CozyMessageRow
            row={r}
            chat={chat}
            onJump={() => undefined}
            onJumpById={() => undefined}
          />
        ) : (
          <MessageRow row={r} chat={chat} onJump={() => undefined} onJumpById={() => undefined} />
        )}
      </RowAppearanceContext.Provider>,
    );

  beforeEach(() => {
    useAuth.setState({ user: me, token: 't', status: 'authenticated' });
    useUsers.getState().upsertUsers([makeUser({ id: ANN, displayName: 'Ann' })]);
  });
  afterEach(() => resetSessionState());

  it('a cozy row is a focusable-from-script article with its label', () => {
    renderRow(row(msg({ id: 'm1', chatId: 'g1', senderId: 'me', text: 'hi there' }), true), true);
    const article = screen.getByRole('article', { name: `Mia Me, ${at}, hi there` });
    expect(article).toHaveAttribute('tabindex', '-1');
    expect(article).toHaveAttribute('aria-setsize', '-1');
    expect(article).toHaveAttribute('aria-roledescription', 'Message');
    expect(article).toHaveAttribute('data-message-id', 'm1');
  });

  it("a bubble row names someone else's message by their name; mentions read as names", () => {
    renderRow(
      row(msg({ id: 'm2', chatId: 'g1', senderId: ANN, text: `ping @{${ANN}} **now**` }), false),
      false,
    );
    expect(screen.getByRole('article', { name: `Ann, ${at}, ping @Ann now` })).toBeInTheDocument();
  });

  it('in a Space, the nickname', () => {
    const channel = makeChat({
      id: 'c1',
      type: 'space_text',
      name: 'general',
      space: { spaceId: 's1' } as SpaceChannelInfo,
    });
    useSpaces.setState({
      members: { s1: { [ANN]: { userId: ANN, nickname: 'Annie' } as unknown as SpaceMember } },
    });
    const m = msg({ id: 'm4', chatId: 'c1', senderId: ANN, text: 'hey' });
    render(
      <RowAppearanceContext.Provider value={{ bubbleStyle: 'classic', messageAnimation: 'none' }}>
        <MessageRow
          row={row(m, false)}
          chat={channel}
          onJump={() => undefined}
          onJumpById={() => undefined}
        />
      </RowAppearanceContext.Provider>,
    );
    expect(screen.getByRole('article', { name: `Annie, ${at}, hey` })).toBeInTheDocument();
  });

  it("a webhook's message is named by the webhook", () => {
    const m = msg({
      id: 'm3',
      chatId: 'g1',
      senderId: null,
      text: 'Deployed',
      authorOverride: { kind: 'webhook', name: 'Deploy Bot', avatarUrl: null, webhookId: 'w1' },
    });
    renderRow(row(m, false), true);
    expect(
      screen.getByRole('article', { name: `Deploy Bot, ${at}, Deployed` }),
    ).toBeInTheDocument();
  });

  it('system rows are not articles', () => {
    const m = msg({
      id: 's1',
      chatId: 'g1',
      type: 'system',
      senderId: null,
      text: null,
      system: { kind: 'member_left', actorId: ANN },
    });
    renderRow(row(m, false), true);
    expect(screen.queryByRole('article')).toBeNull();
  });
});
