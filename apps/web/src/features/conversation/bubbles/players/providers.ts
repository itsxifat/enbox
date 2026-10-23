/**
 * Video and music players of links (Discord's embeds): which provider a link is and the
 * iframe its card swaps in once played. Pure (unit-tested). A player loads on click only —
 * until then the card shows the link preview's cached thumbnail, so the provider learns
 * nothing about who reads the chat — and only PLAYER_ORIGINS may be framed: the CSP's
 * `frame-src` (vite.config.ts) lists exactly these.
 *
 *   YouTube     watch?v=, youtu.be/, /shorts/, /embed/, /live/   → youtube-nocookie.com/embed
 *   Vimeo       vimeo.com/<id>[/<hash>], channels, groups, albums → player.vimeo.com/video
 *   Twitch      channels, /videos/<id>, clips                    → player.twitch.tv, clips.twitch.tv
 *   Spotify     tracks, albums, playlists, episodes, shows       → open.spotify.com/embed
 *   SoundCloud  tracks and sets                                  → w.soundcloud.com/player
 *
 * Direct video files (`.mp4`, `.webm`…) are no player: `videoFileOf` names them for a card
 * that opens them in the browser.
 */

export type PlayerProvider = 'youtube' | 'vimeo' | 'twitch' | 'spotify' | 'soundcloud';

export interface Player {
  provider: PlayerProvider;
  /** The provider as the card names it. */
  label: string;
  /** The iframe's src. */
  src: string;
  /** 'video': a 16:9 frame; 'audio': a compact player `height` px tall. */
  kind: 'video' | 'audio';
  height?: number;
}

/** Origins players are framed from (keep in sync with `frame-src` in vite.config.ts). */
export const PLAYER_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://player.twitch.tv',
  'https://clips.twitch.tv',
  'https://open.spotify.com',
  'https://w.soundcloud.com',
] as const;

/** Hostname without `www.` / `m.`. */
function hostOf(u: URL): string {
  return u.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
}

function segments(u: URL): string[] {
  return u.pathname.split('/').filter(Boolean);
}

/** YouTube's `t=` / `start=`: `90`, `90s`, `1h2m3s` → seconds (0 when absent or invalid). */
export function startSeconds(raw: string | null): number {
  if (!raw) return 0;
  if (/^\d+s?$/.test(raw)) return Number.parseInt(raw, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'music.youtube.com', 'youtube-nocookie.com']);

function youtube(u: URL): Player | null {
  const host = hostOf(u);
  const [first, second] = segments(u);
  let id: string | null | undefined = null;
  if (host === 'youtu.be') id = first;
  else if (YOUTUBE_HOSTS.has(host)) {
    if (first === 'watch') id = u.searchParams.get('v');
    else if (first === 'shorts' || first === 'embed' || first === 'live' || first === 'v')
      id = second;
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  const query = new URLSearchParams({ autoplay: '1' });
  const start = startSeconds(u.searchParams.get('t') ?? u.searchParams.get('start'));
  if (start) query.set('start', String(start));
  return {
    provider: 'youtube',
    label: 'YouTube',
    kind: 'video',
    src: `https://www.youtube-nocookie.com/embed/${id}?${query.toString()}`,
  };
}

const DIGITS = /^\d+$/;

function vimeo(u: URL): Player | null {
  const host = hostOf(u);
  const p = segments(u);
  let id: string | undefined;
  let hash: string | null = null;
  if (host === 'player.vimeo.com') {
    if (p[0] === 'video') id = p[1];
    hash = u.searchParams.get('h');
  } else if (host === 'vimeo.com') {
    if (DIGITS.test(p[0] ?? '')) {
      id = p[0];
      // Unlisted videos: vimeo.com/<id>/<hash>.
      if (p[1] && /^[0-9a-f]+$/i.test(p[1])) hash = p[1];
    } else if (p[0] === 'channels') id = p[2];
    else if (p[0] === 'groups' && p[2] === 'videos') id = p[3];
    else if ((p[0] === 'album' || p[0] === 'showcase') && p[2] === 'video') id = p[3];
  }
  if (!id || !DIGITS.test(id)) return null;
  const query = new URLSearchParams({ autoplay: '1' });
  if (hash && /^[0-9a-f]+$/i.test(hash)) query.set('h', hash);
  return {
    provider: 'vimeo',
    label: 'Vimeo',
    kind: 'video',
    src: `https://player.vimeo.com/video/${id}?${query.toString()}`,
  };
}

/** First path segments of twitch.tv that are pages, not channels. */
const TWITCH_PAGES = new Set([
  'directory',
  'downloads',
  'drops',
  'friends',
  'inventory',
  'jobs',
  'login',
  'messages',
  'moderator',
  'p',
  'prime',
  'privacy',
  'search',
  'settings',
  'signup',
  'store',
  'subscriptions',
  'team',
  'turbo',
  'u',
  'videos',
  'wallet',
]);
const TWITCH_CHANNEL = /^\w{3,25}$/;
const TWITCH_CLIP = /^[\w-]+$/;

function twitch(u: URL, parent: string): Player | null {
  const host = hostOf(u);
  const p = segments(u);
  const player = (query: Record<string, string>, clip = false): Player => ({
    provider: 'twitch',
    label: 'Twitch',
    kind: 'video',
    // `parent`: Twitch only plays inside the page whose host is named here.
    src: clip
      ? `https://clips.twitch.tv/embed?${new URLSearchParams({ ...query, parent, autoplay: 'true' }).toString()}`
      : `https://player.twitch.tv/?${new URLSearchParams({ ...query, parent, autoplay: 'true' }).toString()}`,
  });
  if (host === 'clips.twitch.tv') {
    const slug = p[0];
    return slug && slug !== 'embed' && p.length === 1 && TWITCH_CLIP.test(slug)
      ? player({ clip: slug }, true)
      : null;
  }
  if (host !== 'twitch.tv') return null;
  if (p[0] === 'videos' && p.length === 2 && DIGITS.test(p[1]!)) return player({ video: p[1]! });
  if (p.length === 3 && p[1] === 'clip' && TWITCH_CLIP.test(p[2]!))
    return player({ clip: p[2]! }, true);
  if (p.length === 1 && TWITCH_CHANNEL.test(p[0]!) && !TWITCH_PAGES.has(p[0]!.toLowerCase()))
    return player({ channel: p[0]!.toLowerCase() });
  return null;
}

/** Spotify's compact player heights: one item, or a list. */
const SPOTIFY_HEIGHT: Record<string, number> = {
  track: 152,
  episode: 152,
  album: 352,
  playlist: 352,
  show: 352,
  artist: 352,
};

function spotify(u: URL): Player | null {
  if (u.hostname.toLowerCase() !== 'open.spotify.com') return null;
  let p = segments(u);
  if (/^intl-[a-z]{2}(?:-[a-z]{2})?$/i.test(p[0] ?? '')) p = p.slice(1);
  if (p[0] === 'embed') p = p.slice(1);
  const [type, id] = p;
  const height = type ? SPOTIFY_HEIGHT[type] : undefined;
  if (!height || p.length !== 2 || !/^[A-Za-z0-9]{22}$/.test(id ?? '')) return null;
  return {
    provider: 'spotify',
    label: 'Spotify',
    kind: 'audio',
    height,
    src: `https://open.spotify.com/embed/${type}/${id}`,
  };
}

/** First path segments of soundcloud.com that are pages, not artists. */
const SOUNDCLOUD_PAGES = new Set([
  'charts',
  'connect',
  'discover',
  'feed',
  'imprint',
  'jobs',
  'logout',
  'messages',
  'mobile',
  'notifications',
  'pages',
  'people',
  'player',
  'popular',
  'search',
  'settings',
  'signin',
  'stations',
  'stream',
  'tags',
  'terms-of-use',
  'upload',
  'you',
]);
/** Second segments of an artist's pages that are no track. */
const SOUNDCLOUD_ARTIST_PAGES = new Set([
  'albums',
  'comments',
  'followers',
  'following',
  'likes',
  'popular-tracks',
  'reposts',
  'sets',
  'tracks',
]);
const SOUNDCLOUD_SLUG = /^[\w-]+$/;

function soundcloud(u: URL): Player | null {
  if (hostOf(u) !== 'soundcloud.com') return null;
  const p = segments(u);
  if (!p.every((s) => SOUNDCLOUD_SLUG.test(s))) return null;
  const [artist, second, third] = p;
  if (!artist || !second || SOUNDCLOUD_PAGES.has(artist.toLowerCase())) return null;
  let set = false;
  if (second === 'sets') {
    // A set: /<artist>/sets/<set>[/<secret>].
    if (!third || p.length > 4) return null;
    set = true;
  } else if (SOUNDCLOUD_ARTIST_PAGES.has(second) || p.length > 3) {
    return null;
  } else if (p.length === 3 && !third!.startsWith('s-')) {
    // /<artist>/<track>/s-<secret> is a private link; anything else is a sub-page.
    return null;
  }
  const canonical = `https://soundcloud.com/${p.join('/')}`;
  const query = new URLSearchParams({ url: canonical, auto_play: 'true', visual: 'false' });
  return {
    provider: 'soundcloud',
    label: 'SoundCloud',
    kind: 'audio',
    height: set ? 300 : 166,
    src: `https://w.soundcloud.com/player/?${query.toString()}`,
  };
}

/**
 * The player of a link, or null when it is none of the providers' video / audio pages.
 * `parent` is the host the page is served from (Twitch requires it).
 */
export function playerOf(
  href: string,
  parent: string = typeof location !== 'undefined' ? location.hostname : 'localhost',
): Player | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return youtube(u) ?? vimeo(u) ?? twitch(u, parent) ?? spotify(u) ?? soundcloud(u);
}

const VIDEO_FILE = /\.(?:mp4|m4v|webm|mov|ogv)$/i;

/** A link straight to a video file: its file name, else null. */
export function videoFileOf(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const name = segments(u).at(-1);
  if (!name || !VIDEO_FILE.test(name)) return null;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
