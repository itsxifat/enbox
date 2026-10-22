/**
 * Per-Space profile editor model. The draft is the saved `space.me` with the user's edits on
 * top (`edits`: only what was touched, so a change saved from another device still shows for
 * untouched fields). `serverProfilePatch` is the one `PATCH members/me` body: the changed fields
 * only, null = back to the main profile. Images are staged as uploaded media until Save.
 */
import type { MediaAttachment, SpaceMemberSelf, SpaceProfile, UpdateMyMemberRequest } from '@enbox/shared';

/** A profile image as the draft shows it; `mediaId` only for a new upload (not yet saved). */
export interface DraftImage {
  mediaId?: string;
  url: string;
  animatedUrl: string | null;
}

export interface ServerProfileDraft {
  /** Text as typed ('' = no nickname). */
  nickname: string;
  /** null = the main profile's. */
  avatar: DraftImage | null;
  banner: DraftImage | null;
  pronouns: string;
  bio: string;
  profileColor: string | null;
  accentColor: string | null;
  avatarDecoration: string | null;
  profileEffect: string | null;
  nameplate: string | null;
}

export type ServerProfileEdits = Partial<ServerProfileDraft>;

function savedImage(url: string | null | undefined, animatedUrl: string | null | undefined): DraftImage | null {
  return url ? { url, animatedUrl: animatedUrl ?? null } : null;
}

/** The draft of what is saved. */
export function savedDraft(me: SpaceMemberSelf): ServerProfileDraft {
  return {
    nickname: me.nickname ?? '',
    avatar: savedImage(me.avatarUrl, me.avatarAnimatedUrl),
    banner: savedImage(me.bannerUrl, me.bannerAnimatedUrl),
    pronouns: me.pronouns ?? '',
    bio: me.bio ?? '',
    profileColor: me.profileColor ?? null,
    accentColor: me.accentColor ?? null,
    avatarDecoration: me.avatarDecoration ?? null,
    profileEffect: me.profileEffect ?? null,
    nameplate: me.nameplate ?? null,
  };
}

export function applyEdits(me: SpaceMemberSelf, edits: ServerProfileEdits): ServerProfileDraft {
  return { ...savedDraft(me), ...edits };
}

/** An upload staged as the draft's image (the static poster shows, the original animates). */
export function draftImageFromMedia(media: MediaAttachment): DraftImage {
  return media.animated && media.thumbnailUrl
    ? { mediaId: media.id, url: media.thumbnailUrl, animatedUrl: media.url }
    : { mediaId: media.id, url: media.url, animatedUrl: null };
}

const text = (s: string): string | null => s.trim() || null;

function imagePatch(saved: DraftImage | null, draft: DraftImage | null): string | null | undefined {
  if (draft?.mediaId) return draft.mediaId;
  if (!draft && saved) return null;
  return undefined;
}

/** The changed fields as one `PATCH members/me` body (empty = nothing to save). */
export function serverProfilePatch(me: SpaceMemberSelf, draft: ServerProfileDraft): UpdateMyMemberRequest {
  const saved = savedDraft(me);
  const out: UpdateMyMemberRequest = {};
  if (text(draft.nickname) !== text(saved.nickname)) out.nickname = text(draft.nickname);
  const avatar = imagePatch(saved.avatar, draft.avatar);
  if (avatar !== undefined) out.avatarMediaId = avatar;
  const banner = imagePatch(saved.banner, draft.banner);
  if (banner !== undefined) out.bannerMediaId = banner;
  if (text(draft.pronouns) !== text(saved.pronouns)) out.pronouns = text(draft.pronouns);
  if (text(draft.bio) !== text(saved.bio)) out.bio = text(draft.bio);
  for (const k of ['profileColor', 'accentColor', 'avatarDecoration', 'profileEffect', 'nameplate'] as const)
    if (draft[k] !== saved[k]) out[k] = draft[k];
  return out;
}

/** The draft as `SpaceProfile` overrides (the preview merges them over my main profile). */
export function draftProfile(draft: ServerProfileDraft): SpaceProfile {
  return {
    avatarUrl: draft.avatar?.url ?? null,
    avatarAnimatedUrl: draft.avatar?.animatedUrl ?? null,
    bannerUrl: draft.banner?.url ?? null,
    bannerAnimatedUrl: draft.banner?.animatedUrl ?? null,
    bio: text(draft.bio),
    pronouns: text(draft.pronouns),
    profileColor: draft.profileColor,
    accentColor: draft.accentColor,
    avatarDecoration: draft.avatarDecoration,
    profileEffect: draft.profileEffect,
    nameplate: draft.nameplate,
  };
}

/** Whether the draft overrides the field (the "Reset to main profile" buttons). */
export function isOverridden(draft: ServerProfileDraft, field: keyof ServerProfileDraft): boolean {
  const v = draft[field];
  return typeof v === 'string' ? v.trim() !== '' : v !== null;
}

/** Each field's "use the main profile" value. */
export const RESET_VALUES: { [K in keyof ServerProfileDraft]: ServerProfileDraft[K] } = {
  nickname: '',
  avatar: null,
  banner: null,
  pronouns: '',
  bio: '',
  profileColor: null,
  accentColor: null,
  avatarDecoration: null,
  profileEffect: null,
  nameplate: null,
};
