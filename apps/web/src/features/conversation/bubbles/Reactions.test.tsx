import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { computeChatPermissions } from '@enbox/shared';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { ReactionsDialog } from './Reactions';

function setup(membership: 'active' | 'left') {
  const me = makeMe();
  useAuth.setState({ user: me });
  const base = makeChat({ type: 'group', membership });
  const chat = { ...base, permissions: computeChatPermissions(base, me.id) };
  const m = makeMessage({
    id: 'm1',
    chatId: chat.id,
    reactions: [{ emoji: '👍', count: 1, userIds: [me.id] }],
    myReaction: '👍',
  });
  render(<ReactionsDialog m={m} chat={chat} open onClose={() => undefined} />);
}

describe('ReactionsDialog', () => {
  afterEach(() => resetSessionState());

  it('lets an active member remove their reaction', () => {
    setup('active');
    expect(screen.getByText('Tap to remove')).toBeInTheDocument();
  });

  it('does not offer a removal that would do nothing (former member)', () => {
    setup('left');
    expect(screen.queryByText('Tap to remove')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reacted 👍/ })).toBeDisabled();
  });
});
