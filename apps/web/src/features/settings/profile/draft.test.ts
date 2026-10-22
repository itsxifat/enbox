import { describe, expect, it } from 'vitest';
import type { MediaAttachment } from '@enbox/shared';
import { makeMe } from '@/test/factories';
import {
  REMOVED_IMAGE,
  applyEdits,
  draftCardUser,
  draftFromMe,
  profilePatch,
  sameNameStyle,
  stagedFromMedia,
} from './draft';

const me = makeMe({
  id: 'me',
  username: 'ada',
  displayName: 'Ada Lovelace',
  pronouns: 'she/her',
  bio: 'First programmer.',
  profileColor: '#112233',
  avatarUrl: '/uploads/a.jpg',
  avatarDecoration: 'orbit',
  nameStyle: { font: 'pixel', effect: 'solid', colors: ['#ff0000'] },
});

function media(p: Partial<MediaAttachment> = {}): MediaAttachment {
  return {
    id: 'm1',
    kind: 'image',
    url: '/uploads/new.jpg',
    thumbnailUrl: null,
    mimeType: 'image/jpeg',
    fileName: 'avatar.jpg',
    size: 1,
    width: 1,
    height: 1,
    animated: false,
    frameCount: null,
    durationMs: null,
    waveform: null,
    ...p,
  };
}

describe('profile draft', () => {
  it('an untouched draft patches nothing', () => {
    expect(profilePatch(me, draftFromMe(me))).toEqual({});
    // Edits back to the saved values are not changes either.
    expect(
      profilePatch(me, applyEdits(me, { pronouns: ' she/her ', bio: 'First programmer.  ' })),
    ).toEqual({});
  });

  it('patches only the changed fields', () => {
    const draft = applyEdits(me, {
      bio: '  Engines.  ',
      avatarDecoration: null,
      profileEffect: 'aurora',
      accentColor: '#445566',
    });
    expect(profilePatch(me, draft)).toEqual({
      bio: 'Engines.',
      avatarDecoration: null,
      profileEffect: 'aurora',
      accentColor: '#445566',
    });
  });

  it('a cleared display name falls back to the username; blank pronouns clear them', () => {
    expect(profilePatch(me, applyEdits(me, { displayName: '   ', pronouns: '  ' }))).toEqual({
      displayName: 'ada',
      pronouns: null,
    });
    expect(draftCardUser(me, applyEdits(me, { displayName: '' })).displayName).toBe('ada');
  });

  it('compares name styles by value', () => {
    const same = { font: 'pixel', effect: 'solid', colors: ['#FF0000'] } as const;
    expect(sameNameStyle(me.nameStyle, { ...same, colors: [...same.colors] })).toBe(true);
    expect(
      profilePatch(me, applyEdits(me, { nameStyle: { ...same, colors: ['#ff0000'] } })),
    ).toEqual({});
    const gradient = {
      font: 'pixel' as const,
      effect: 'gradient' as const,
      colors: ['#ff0000', '#00ff00'],
    };
    expect(profilePatch(me, applyEdits(me, { nameStyle: gradient }))).toEqual({
      nameStyle: gradient,
    });
    expect(profilePatch(me, applyEdits(me, { nameStyle: null }))).toEqual({ nameStyle: null });
  });

  it('stages avatar and banner uploads and removals', () => {
    const staged = stagedFromMedia(media());
    expect(staged).toEqual({ mediaId: 'm1', url: '/uploads/new.jpg', animatedUrl: null });
    expect(
      stagedFromMedia(
        media({ animated: true, url: '/uploads/a.gif', thumbnailUrl: '/uploads/a.webp' }),
      ),
    ).toEqual({ mediaId: 'm1', url: '/uploads/a.webp', animatedUrl: '/uploads/a.gif' });

    expect(profilePatch(me, applyEdits(me, { avatar: staged, banner: staged }))).toEqual({
      avatarMediaId: 'm1',
      bannerMediaId: 'm1',
    });
    // Removing a photo I have is a change; "removing" a banner I don't have is not.
    expect(
      profilePatch(me, applyEdits(me, { avatar: REMOVED_IMAGE, banner: REMOVED_IMAGE })),
    ).toEqual({
      avatarMediaId: null,
    });
  });

  it('the preview user wears the draft', () => {
    const user = draftCardUser(
      me,
      applyEdits(me, {
        avatar: REMOVED_IMAGE,
        nameplate: 'galaxy',
        profileEffect: 'snowfall',
        bio: '',
        pronouns: 'they/them',
      }),
    );
    expect(user).toMatchObject({
      id: 'me',
      displayName: 'Ada Lovelace',
      avatarUrl: null,
      avatarDecoration: 'orbit',
      nameplate: 'galaxy',
      profileEffect: 'snowfall',
      bio: null,
      pronouns: 'they/them',
      profileColor: '#112233',
    });
  });
});
