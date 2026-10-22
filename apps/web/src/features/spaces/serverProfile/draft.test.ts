import { describe, expect, it } from 'vitest';
import type { MediaAttachment, UserPublic } from '@enbox/shared';
import { makeSpace } from '../testUtils';
import { applyEdits, draftImageFromMedia, draftProfile, savedDraft, serverProfilePatch } from './draft';
import { withSpaceProfile } from './merge';

const media = (p: Partial<MediaAttachment>): MediaAttachment =>
  ({
    id: 'm1',
    kind: 'image',
    url: '/uploads/a.gif',
    thumbnailUrl: null,
    mimeType: 'image/png',
    fileName: null,
    size: 1,
    width: 1,
    height: 1,
    animated: false,
    frameCount: null,
    durationMs: null,
    waveform: null,
    ...p,
  }) as MediaAttachment;

describe('server profile draft', () => {
  const saved = makeSpace({
    me: {
      nickname: 'Nick',
      avatarUrl: '/uploads/old.jpg',
      avatarAnimatedUrl: null,
      bio: 'Saved bio',
      nameplate: 'galaxy',
    },
  }).me;

  it('nothing edited → an empty patch', () => {
    expect(serverProfilePatch(saved, savedDraft(saved))).toEqual({});
    // Edits back to the saved value (or only whitespace changes) are not changes.
    expect(serverProfilePatch(saved, applyEdits(saved, { bio: ' Saved bio ', nickname: 'Nick' }))).toEqual({});
  });

  it('sends only the changed fields; empty text and "use main" are null', () => {
    const draft = applyEdits(saved, {
      nickname: '  ',
      bio: '',
      pronouns: 'she/her',
      profileColor: '#112233',
      nameplate: null,
      avatarDecoration: 'halo',
      avatar: null,
    });
    expect(serverProfilePatch(saved, draft)).toEqual({
      nickname: null,
      bio: null,
      pronouns: 'she/her',
      profileColor: '#112233',
      nameplate: null,
      avatarDecoration: 'halo',
      avatarMediaId: null,
    });
  });

  it('a staged upload sends its media id; animated uploads preview their poster', () => {
    const still = draftImageFromMedia(media({ id: 'still', url: '/uploads/s.jpg' }));
    expect(still).toEqual({ mediaId: 'still', url: '/uploads/s.jpg', animatedUrl: null });
    const anim = draftImageFromMedia(
      media({ id: 'anim', url: '/uploads/a.gif', thumbnailUrl: '/uploads/a.webp', animated: true }),
    );
    expect(anim).toEqual({ mediaId: 'anim', url: '/uploads/a.webp', animatedUrl: '/uploads/a.gif' });
    const draft = applyEdits(saved, { avatar: anim, banner: still });
    expect(serverProfilePatch(saved, draft)).toEqual({ avatarMediaId: 'anim', bannerMediaId: 'still' });
    expect(draftProfile(draft)).toMatchObject({
      avatarUrl: '/uploads/a.webp',
      avatarAnimatedUrl: '/uploads/a.gif',
      bannerUrl: '/uploads/s.jpg',
    });
  });

  it('withSpaceProfile: overrides win, nulls fall through to the main profile', () => {
    const user = {
      id: 'u',
      displayName: 'Main',
      avatarUrl: '/uploads/main.jpg',
      avatarAnimatedUrl: '/uploads/main.gif',
      bannerUrl: null,
      bannerAnimatedUrl: null,
      bio: 'Main bio',
      pronouns: 'they/them',
      profileColor: '#000000',
      accentColor: null,
      avatarDecoration: 'orbit',
      isDeleted: false,
    } as unknown as UserPublic;
    const merged = withSpaceProfile(user, { avatarUrl: '/uploads/space.jpg', bio: null, nameplate: 'ocean' }, 'Nick');
    expect(merged).toMatchObject({
      displayName: 'Nick',
      avatarUrl: '/uploads/space.jpg',
      // A still override does not animate with the main GIF.
      avatarAnimatedUrl: null,
      bio: 'Main bio',
      pronouns: 'they/them',
      avatarDecoration: 'orbit',
      nameplate: 'ocean',
    });
    expect(withSpaceProfile(user, null)).toBe(user);
    expect(withSpaceProfile({ ...user, isDeleted: true }, { bio: 'x' }, 'Nick').displayName).toBe('Main');
  });
});
