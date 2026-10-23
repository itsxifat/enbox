/**
 * Player URLs per provider (YouTube, Vimeo, Twitch, Spotify, SoundCloud), what is not a
 * player, video file links, and the CSP's frame-src matching PLAYER_ORIGINS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAYER_ORIGINS, playerOf, startSeconds, videoFileOf } from './providers';

const src = (url: string, parent = 'app.example') => playerOf(url, parent)?.src ?? null;

describe('playerOf', () => {
  it('YouTube: watch, youtu.be, shorts, embed and live links play on youtube-nocookie', () => {
    const embed = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1';
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ?si=abc',
    ])
      expect(src(url), url).toBe(embed);
    expect(playerOf('https://youtu.be/dQw4w9WgXcQ')).toMatchObject({
      provider: 'youtube',
      label: 'YouTube',
      kind: 'video',
    });
    // A start time carries over.
    expect(src('https://youtu.be/dQw4w9WgXcQ?t=90')).toBe(`${embed}&start=90`);
    expect(src('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toBe(`${embed}&start=90`);
    expect(startSeconds('1h2m3s')).toBe(3723);
    expect(startSeconds('nope')).toBe(0);
    // Channels, playlists and bad ids are not players.
    for (const url of [
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/watch?v=short',
      'https://youtu.be/',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    ])
      expect(playerOf(url), url).toBeNull();
  });

  it('Vimeo: videos, unlisted hashes, channels, groups and showcases', () => {
    const embed = 'https://player.vimeo.com/video/76979871?autoplay=1';
    for (const url of [
      'https://vimeo.com/76979871',
      'https://www.vimeo.com/76979871',
      'https://vimeo.com/channels/staffpicks/76979871',
      'https://vimeo.com/groups/shortfilms/videos/76979871',
      'https://vimeo.com/showcase/123/video/76979871',
      'https://player.vimeo.com/video/76979871',
    ])
      expect(src(url), url).toBe(embed);
    expect(src('https://vimeo.com/76979871/a1b2c3d4e5')).toBe(`${embed}&h=a1b2c3d4e5`);
    expect(playerOf('https://vimeo.com/76979871')?.kind).toBe('video');
    expect(playerOf('https://vimeo.com/staff')).toBeNull();
    expect(playerOf('https://vimeo.com/channels/staffpicks')).toBeNull();
  });

  it('Twitch: channels, videos and clips, with the page as parent', () => {
    expect(src('https://www.twitch.tv/SomeStreamer')).toBe(
      'https://player.twitch.tv/?channel=somestreamer&parent=app.example&autoplay=true',
    );
    expect(src('https://www.twitch.tv/videos/1234567890')).toBe(
      'https://player.twitch.tv/?video=1234567890&parent=app.example&autoplay=true',
    );
    expect(src('https://clips.twitch.tv/FunnyClipSlug-abc_123')).toBe(
      'https://clips.twitch.tv/embed?clip=FunnyClipSlug-abc_123&parent=app.example&autoplay=true',
    );
    expect(src('https://www.twitch.tv/somestreamer/clip/FunnyClipSlug')).toBe(
      'https://clips.twitch.tv/embed?clip=FunnyClipSlug&parent=app.example&autoplay=true',
    );
    expect(src('https://m.twitch.tv/somestreamer', 'enbox.example')).toContain(
      'parent=enbox.example',
    );
    for (const url of [
      'https://www.twitch.tv/directory',
      'https://www.twitch.tv/settings',
      'https://www.twitch.tv/somestreamer/videos',
      'https://www.twitch.tv/',
      'https://clips.twitch.tv/embed',
    ])
      expect(playerOf(url), url).toBeNull();
  });

  it('Spotify: tracks and episodes compact, albums and playlists taller', () => {
    const id = '4cOdK2wGLETKBW3PvgPWqT';
    expect(playerOf(`https://open.spotify.com/track/${id}?si=xyz`)).toEqual({
      provider: 'spotify',
      label: 'Spotify',
      kind: 'audio',
      height: 152,
      src: `https://open.spotify.com/embed/track/${id}`,
    });
    expect(playerOf(`https://open.spotify.com/intl-de/album/${id}`)).toMatchObject({
      src: `https://open.spotify.com/embed/album/${id}`,
      height: 352,
    });
    expect(src(`https://open.spotify.com/playlist/${id}`)).toBe(
      `https://open.spotify.com/embed/playlist/${id}`,
    );
    expect(playerOf(`https://open.spotify.com/episode/${id}`)?.height).toBe(152);
    expect(playerOf('https://open.spotify.com/track/short')).toBeNull();
    expect(playerOf(`https://open.spotify.com/user/${id}`)).toBeNull();
    expect(playerOf(`https://spotify.com/track/${id}`)).toBeNull();
  });

  it('SoundCloud: tracks and sets through the widget', () => {
    expect(playerOf('https://soundcloud.com/artist-name/track-name')).toEqual({
      provider: 'soundcloud',
      label: 'SoundCloud',
      kind: 'audio',
      height: 166,
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent('https://soundcloud.com/artist-name/track-name')}&auto_play=true&visual=false`,
    });
    expect(playerOf('https://m.soundcloud.com/artist-name/sets/my-set')).toMatchObject({
      height: 300,
      src: expect.stringContaining(
        encodeURIComponent('https://soundcloud.com/artist-name/sets/my-set'),
      ),
    });
    expect(playerOf('https://soundcloud.com/artist-name/track-name/s-SeCrEt')?.provider).toBe(
      'soundcloud',
    );
    for (const url of [
      'https://soundcloud.com/artist-name',
      'https://soundcloud.com/artist-name/likes',
      'https://soundcloud.com/discover/sets/charts',
      'https://soundcloud.com/search/sounds',
      'https://soundcloud.com/artist-name/track-name/comments',
    ])
      expect(playerOf(url), url).toBeNull();
  });

  it('everything else is no player', () => {
    for (const url of [
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'ftp://youtu.be/dQw4w9WgXcQ',
      'nope',
    ])
      expect(playerOf(url), url).toBeNull();
  });
});

describe('videoFileOf', () => {
  it('names direct video files, nothing else', () => {
    expect(videoFileOf('https://cdn.example.com/media/My%20clip.mp4')).toBe('My clip.mp4');
    expect(videoFileOf('https://cdn.example.com/a.webm?x=1')).toBe('a.webm');
    expect(videoFileOf('https://cdn.example.com/a.MOV')).toBe('a.MOV');
    expect(videoFileOf('https://cdn.example.com/a.mp3')).toBeNull();
    expect(videoFileOf('https://cdn.example.com/')).toBeNull();
  });
});

describe('the CSP', () => {
  it('frames exactly the player origins', () => {
    // (Not `new URL(…, import.meta.url)`: Vite rewrites that into an asset URL.)
    const here = fileURLToPath(import.meta.url.replace(/[^/]+$/, ''));
    const config = fs.readFileSync(path.resolve(here, '../../../../../vite.config.ts'), 'utf8');
    const list = /const PLAYER_FRAME_ORIGINS = \[([\s\S]*?)\]/.exec(config)?.[1] ?? '';
    const framed = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(framed).toEqual([...PLAYER_ORIGINS]);
    expect(config).toContain("`frame-src ${PLAYER_FRAME_ORIGINS.join(' ')}`");
  });

  it('every player loads from a framed origin', () => {
    const id = '4cOdK2wGLETKBW3PvgPWqT';
    for (const url of [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://vimeo.com/76979871',
      'https://www.twitch.tv/somestreamer',
      'https://clips.twitch.tv/Slug',
      `https://open.spotify.com/track/${id}`,
      'https://soundcloud.com/a/b',
    ]) {
      const origin = new URL(playerOf(url)!.src).origin;
      expect(PLAYER_ORIGINS as readonly string[], url).toContain(origin);
    }
  });
});
