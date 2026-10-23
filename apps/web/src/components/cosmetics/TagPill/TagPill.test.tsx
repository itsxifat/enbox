/**
 * Server tag pills: the badge in the tag's colour next to the tag, and the users-store pill
 * that shows what someone wears (nothing when they wear none), named after my Space.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SPACE_TAG_BADGES, type UserSpaceTag } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUsers } from '@/stores/users';
import { makeSpace } from '@/features/spaces/testUtils';
import { makeMe, makeUser } from '@/test/factories';
import { SPACE_TAG_BADGE_ICONS, SPACE_TAG_BADGE_LABELS } from './badges';
import { ServerTagPill } from './ServerTagPill';
import { TagPill } from './TagPill';

const rkt: UserSpaceTag = { spaceId: 's1', tag: 'RKT', badge: 'rocket', color: '#ff8800' };

function seedSpaces(...spaces: ReturnType<typeof makeSpace>[]) {
  useSpaces.setState({
    byId: Object.fromEntries(spaces.map((s) => [s.id, s])),
    order: spaces.map((s) => s.id),
    loaded: true,
  });
}

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
});

describe('TagPill', () => {
  it('draws the badge in the tag colour next to the tag, in two sizes', () => {
    const { rerender } = render(<TagPill tag={rkt} title="Tag from Rocket Club" />);
    const pill = screen.getByTestId('server-tag');
    expect(pill).toHaveTextContent(/^RKT$/);
    expect(pill).toHaveAttribute('title', 'Tag from Rocket Club');
    const icon = pill.querySelector('svg')!;
    expect(icon).toHaveClass('lucide-rocket');
    expect(icon).toHaveAttribute('stroke', '#ff8800');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('width', '10');
    rerender(<TagPill tag={{ ...rkt, badge: 'bolt' }} size="md" />);
    const md = screen.getByTestId('server-tag').querySelector('svg')!;
    expect(md).toHaveClass('lucide-zap');
    expect(md).toHaveAttribute('width', '12');
  });

  it('maps every badge id to an icon and a name', () => {
    for (const b of SPACE_TAG_BADGES) {
      expect(SPACE_TAG_BADGE_ICONS[b]).toBeTruthy();
      expect(SPACE_TAG_BADGE_LABELS[b]).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});

describe('ServerTagPill', () => {
  it('shows the tag a user wears, named after my Space; nothing when they wear none', () => {
    seedSpaces(makeSpace({ id: 's1', name: 'Rocket Club', tag: rkt }));
    useUsers
      .getState()
      .upsertUsers([makeUser({ id: 'u1', spaceTag: rkt }), makeUser({ id: 'u2', spaceTag: null })]);
    const { rerender } = render(<ServerTagPill userId="u1" />);
    expect(screen.getByTestId('server-tag')).toHaveTextContent('RKT');
    expect(screen.getByTestId('server-tag')).toHaveAttribute('title', 'Tag from Rocket Club');

    rerender(<ServerTagPill userId="u2" />);
    expect(screen.queryByTestId('server-tag')).toBeNull();

    // A Space I'm not in: no name to show.
    useUsers
      .getState()
      .upsertUsers([makeUser({ id: 'u3', spaceTag: { ...rkt, spaceId: 'elsewhere' } })]);
    rerender(<ServerTagPill userId="u3" />);
    expect(screen.getByTestId('server-tag')).toHaveAttribute('title', 'Space tag');
  });

  it('a tag from the caller wins over the store (null hides it)', () => {
    useUsers.getState().upsertUsers([makeUser({ id: 'u1', spaceTag: rkt })]);
    const { rerender } = render(<ServerTagPill userId="u1" tag={{ ...rkt, tag: 'NEW' }} />);
    expect(screen.getByTestId('server-tag')).toHaveTextContent('NEW');
    rerender(<ServerTagPill userId="u1" tag={null} />);
    expect(screen.queryByTestId('server-tag')).toBeNull();
  });

  it('loads a missing user, but mine only once one of my Spaces has a tag', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockImplementation(
        async (_path: string, body: unknown) =>
          (body as { userIds: string[] }).userIds.map((id) =>
            makeUser({ id, spaceTag: rkt }),
          ) as never,
      );
    const { rerender } = render(<ServerTagPill userId="me" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByTestId('server-tag')).toBeNull();

    seedSpaces(makeSpace({ id: 's1', name: 'Rocket Club', tag: rkt }));
    rerender(<ServerTagPill userId="me" />);
    expect(await screen.findByTestId('server-tag')).toHaveTextContent('RKT');
    expect(post).toHaveBeenCalledWith('/api/users/batch', { userIds: ['me'] });

    render(<ServerTagPill userId="u9" />);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/users/batch', { userIds: ['u9'] }));
  });
});
