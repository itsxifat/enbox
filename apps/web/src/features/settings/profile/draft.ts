/**
 * The profile editor's draft (Settings → Profiles). The draft is my profile plus my edits:
 * nothing is saved until Save Changes, which sends exactly one `PATCH /api/me` carrying only
 * the fields that differ from the saved profile (`profilePatch`). Avatar and banner uploads
 * are staged: the crop dialog uploads the media and the draft keeps its id (and URLs for the
 * preview) until Save sets it.
 */
import type { MediaAttachment, NameStyle, UpdateProfileRequest, UserSelf } from '@enbox/shared';
import { selfCardUser, type ProfileCardUser } from '@/features/profile/model';

/** An avatar / banner change waiting for Save: new media, or `mediaId: null` to remove it. */
export interface StagedImage {
  mediaId: string | null;
  /** Static image the preview shows (the poster of an animated upload). */
  url: string | null;
  animatedUrl: string | null;
}

export interface ProfileDraft {
  /** As typed; blank falls back to the username on save (the name can't be empty). */
  displayName: string;
  pronouns: string;
  bio: string;
  profileColor: string | null;
  accentColor: string | null;
  avatarDecoration: string | null;
  profileEffect: string | null;
  nameplate: string | null;
  nameStyle: NameStyle | null;
  /** Absent = unchanged. */
  avatar?: StagedImage;
  banner?: StagedImage;
}

export type DraftEdits = Partial<ProfileDraft>;

export function draftFromMe(me: UserSelf): ProfileDraft {
  return {
    displayName: me.displayName,
    pronouns: me.pronouns ?? '',
    bio: me.bio,
    profileColor: me.profileColor,
    accentColor: me.accentColor,
    avatarDecoration: me.avatarDecoration ?? null,
    profileEffect: me.profileEffect ?? null,
    nameplate: me.nameplate ?? null,
    nameStyle: me.nameStyle ?? null,
  };
}

/** My saved profile with the edits on top (fields I haven't touched follow the server). */
export function applyEdits(me: UserSelf, edits: DraftEdits): ProfileDraft {
  return { ...draftFromMe(me), ...edits };
}

export function sameNameStyle(a: NameStyle | null | undefined, b: NameStyle | null | undefined) {
  if (!a || !b) return !a && !b;
  return (
    a.font === b.font &&
    a.effect === b.effect &&
    a.colors.length === b.colors.length &&
    a.colors.every((c, i) => c.toLowerCase() === b.colors[i]?.toLowerCase())
  );
}

/** The display name Save would send: trimmed, or my username when cleared. */
export function effectiveDisplayName(me: Pick<UserSelf, 'username'>, draft: ProfileDraft): string {
  return draft.displayName.trim() || me.username;
}

/** Media → what the preview shows (mirrors the server: `avatarUrl` stays the static poster). */
export function stagedFromMedia(media: MediaAttachment): StagedImage {
  const animated = media.animated && !!media.thumbnailUrl;
  return {
    mediaId: media.id,
    url: animated ? media.thumbnailUrl : media.url,
    animatedUrl: animated ? media.url : null,
  };
}

export const REMOVED_IMAGE: StagedImage = { mediaId: null, url: null, animatedUrl: null };

/** Only the fields that differ from my saved profile (empty when nothing changed). */
export function profilePatch(me: UserSelf, draft: ProfileDraft): UpdateProfileRequest {
  const patch: UpdateProfileRequest = {};
  const name = effectiveDisplayName(me, draft);
  if (name !== me.displayName) patch.displayName = name;
  const pronouns = draft.pronouns.trim();
  if (pronouns !== (me.pronouns ?? '')) patch.pronouns = pronouns || null;
  const bio = draft.bio.trim();
  if (bio !== me.bio) patch.bio = bio;
  if (draft.profileColor !== me.profileColor) patch.profileColor = draft.profileColor;
  if (draft.accentColor !== me.accentColor) patch.accentColor = draft.accentColor;
  if (draft.avatarDecoration !== (me.avatarDecoration ?? null))
    patch.avatarDecoration = draft.avatarDecoration;
  if (draft.profileEffect !== (me.profileEffect ?? null)) patch.profileEffect = draft.profileEffect;
  if (draft.nameplate !== (me.nameplate ?? null)) patch.nameplate = draft.nameplate;
  if (!sameNameStyle(draft.nameStyle, me.nameStyle)) patch.nameStyle = draft.nameStyle;
  if (draft.avatar && !(draft.avatar.mediaId === null && !me.avatarUrl))
    patch.avatarMediaId = draft.avatar.mediaId;
  if (draft.banner && !(draft.banner.mediaId === null && !me.bannerUrl))
    patch.bannerMediaId = draft.banner.mediaId;
  return patch;
}

/** The avatar the draft shows (staged upload / removal, else the saved one). */
export function draftAvatar(me: UserSelf, draft: ProfileDraft) {
  return draft.avatar
    ? { url: draft.avatar.url, animatedUrl: draft.avatar.animatedUrl }
    : { url: me.avatarUrl, animatedUrl: me.avatarAnimatedUrl };
}

export function draftBanner(me: UserSelf, draft: ProfileDraft) {
  return draft.banner
    ? { url: draft.banner.url, animatedUrl: draft.banner.animatedUrl }
    : { url: me.bannerUrl, animatedUrl: me.bannerAnimatedUrl };
}

/** My card as it will look after Save (the live preview). */
export function draftCardUser(me: UserSelf, draft: ProfileDraft): ProfileCardUser {
  const avatar = draftAvatar(me, draft);
  const banner = draftBanner(me, draft);
  return {
    ...selfCardUser(me),
    displayName: effectiveDisplayName(me, draft),
    pronouns: draft.pronouns.trim() || null,
    bio: draft.bio.trim() || null,
    profileColor: draft.profileColor,
    accentColor: draft.accentColor,
    avatarUrl: avatar.url,
    avatarAnimatedUrl: avatar.animatedUrl,
    bannerUrl: banner.url,
    bannerAnimatedUrl: banner.animatedUrl,
    avatarDecoration: draft.avatarDecoration,
    profileEffect: draft.profileEffect,
    nameplate: draft.nameplate,
    nameStyle: draft.nameStyle,
  };
}
