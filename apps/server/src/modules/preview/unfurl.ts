/**
 * Invite unfurls (docs/design/discord-parity.md W12-D): `/join/:code` is the SPA, but link
 * previews elsewhere (chat apps, social sites) read its HTML without running any script. The
 * SPA fallback therefore serves `index.html` there with Open Graph and Twitter tags for the
 * Space: "Join <Space> on Enbox", its description (or its member count) and its icon.
 *
 * - The tags go in just before `</head>`, outside every script, style and comment: the CSP
 *   meta and the inline theme script (allowed by its hash) stay byte for byte as built.
 * - Codes are looked up like `GET /invites/:code` resolves a Space (`findSpaceInvite`: an
 *   invite code or a vanity code). Anything else — unknown, expired or used-up codes, group
 *   and channel invites — gets the plain `index.html`, as does any failure. Answers (misses
 *   too) are cached per code for UNFURL_TTL_MS; past a per-IP budget of lookups, pages go
 *   out plain rather than querying.
 * - Everything inserted is HTML-escaped. Absolute URLs come from `config.publicUrl`; without
 *   one there is no og:url or og:image (the Host header is not trusted).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from 'express';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { limitUser } from '../../lib/userLimit.js';
import { loadMediaMap, staticMediaUrl } from '../../services/media.js';
import { inviteOrVanityParamsSchema } from '../community/service.js';
import { findSpaceInvite } from '../spaces/invites.js';

/** How long a code's answer is reused. */
export const UNFURL_TTL_MS = 60_000;
const UNFURL_CACHE_MAX = 2_000;
/** Lookups (cache misses) per IP and minute; above it pages go out without tags. */
const UNFURL_LOOKUPS = { limit: 120, windowMs: 60_000 } as const;
const NAME_MAX = 100;
const DESCRIPTION_MAX = 300;
/** og:image of a Space without an icon (the web build's app icon). */
const FALLBACK_IMAGE = '/icons/icon-512.png';

/** What an invite unfurls to. */
export interface InviteUnfurl {
  spaceName: string;
  description: string | null;
  memberCount: number;
  /** The Space icon (`/uploads/…`, its static image), null without one. */
  iconPath: string | null;
  /** When the invite stops working (ms epoch), null = never. */
  expiresAt: number | null;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** One line of at most `max` characters (whitespace runs and control characters folded). */
function oneLine(text: string | null | undefined, max: number): string {
  // eslint-disable-next-line no-control-regex
  const flat = (text ?? '').replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
    : flat;
}

function membersLabel(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'member' : 'members'}`;
}

/** The `<meta>` tags of an invite (escaped). `publicUrl` has no trailing slash. */
export function inviteMetaTags(u: InviteUnfurl, code: string, publicUrl: string | null): string[] {
  const title = `Join ${oneLine(u.spaceName, NAME_MAX)} on Enbox`;
  const description = oneLine(u.description, DESCRIPTION_MAX) || membersLabel(u.memberCount);
  const image = publicUrl ? `${publicUrl}${u.iconPath ?? FALLBACK_IMAGE}` : null;
  const url = publicUrl ? `${publicUrl}/join/${encodeURIComponent(code)}` : null;
  const tags: ([attr: 'property' | 'name', key: string, value: string] | null)[] = [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Enbox'],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    url ? ['property', 'og:url', url] : null,
    image ? ['property', 'og:image', image] : null,
    ['name', 'twitter:card', 'summary'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    image ? ['name', 'twitter:image', image] : null,
  ];
  return tags
    .filter((t) => t !== null)
    .map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`);
}

/**
 * Where tags can go in `html`: the index of the `</head>` that closes the head, skipping any
 * inside a script, a style or a comment (-1 when there is none).
 */
export function headEnd(html: string): number {
  const skip: [number, number][] = [];
  for (const m of html.matchAll(/<(script|style)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi))
    skip.push([m.index, m.index + m[0].length]);
  for (const m of html.matchAll(/<\/head\s*>/gi))
    if (!skip.some(([from, to]) => m.index >= from && m.index < to)) return m.index;
  return -1;
}

/** `html` with `tags` inserted at `at` (from `headEnd`), one per line. */
export function insertTags(html: string, at: number, tags: readonly string[]): string {
  if (at < 0 || tags.length === 0) return html;
  return `${html.slice(0, at)}  ${tags.join('\n    ')}\n  ${html.slice(at)}`;
}

// ---------------------------------------------------------------------------
// index.html and the lookups
// ---------------------------------------------------------------------------

interface Template {
  file: string;
  mtimeMs: number;
  size: number;
  html: string;
  at: number;
}

let template: Template | null = null;

/** The built `index.html`, read again whenever the file changes (a deploy). */
async function loadTemplate(file: string): Promise<Template> {
  const st = await fs.stat(file);
  if (template?.file === file && template.mtimeMs === st.mtimeMs && template.size === st.size)
    return template;
  const html = await fs.readFile(file, 'utf8');
  template = { file, mtimeMs: st.mtimeMs, size: st.size, html, at: headEnd(html) };
  return template;
}

const cache = new Map<string, { at: number; value: InviteUnfurl | null }>();

/** Forget cached answers and the template (tests). */
export function resetUnfurlCache(): void {
  cache.clear();
  template = null;
}

async function lookup(code: string): Promise<InviteUnfurl | null> {
  const target = await findSpaceInvite(db, code);
  if (!target) return null;
  const { space, invite } = target;
  if (invite && invite.maxUses > 0 && invite.uses >= invite.maxUses) return null;
  const icon = space.iconMediaId
    ? (await loadMediaMap(db, [space.iconMediaId])).get(space.iconMediaId)
    : undefined;
  return {
    spaceName: space.name,
    description: space.description,
    memberCount: space.memberCount,
    iconPath: icon ? staticMediaUrl(icon) : null,
    expiresAt: invite?.expiresAt?.getTime() ?? null,
  };
}

/** A code's unfurl (cached; misses count against the IP's budget). */
async function unfurlOf(code: string, ip: string): Promise<InviteUnfurl | null> {
  const now = Date.now();
  let entry = cache.get(code);
  if (!entry || now - entry.at >= UNFURL_TTL_MS) {
    if (!limitUser(ip, 'inviteUnfurl', UNFURL_LOOKUPS.limit, UNFURL_LOOKUPS.windowMs)) return null;
    entry = { at: now, value: await lookup(code) };
    cache.delete(code);
    if (cache.size >= UNFURL_CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(code, entry);
  }
  const u = entry.value;
  return u && (u.expiresAt === null || u.expiresAt > now) ? u : null;
}

/**
 * `GET /join/:code` of the SPA fallback: `index.html` of `distDir`, with the invite's tags
 * when the code is a working Space invite. Hands over to the next route when the file can't
 * be read.
 */
export function inviteUnfurl(distDir: string): RequestHandler {
  const file = path.join(distDir, 'index.html');
  return async (req, res, next) => {
    let page: Template;
    try {
      page = await loadTemplate(file);
    } catch {
      next();
      return;
    }
    let html = page.html;
    const params = inviteOrVanityParamsSchema.safeParse(req.params);
    if (params.success && page.at >= 0) {
      try {
        const u = await unfurlOf(params.data.code, req.ip ?? '');
        if (u)
          html = insertTags(html, page.at, inviteMetaTags(u, params.data.code, config.publicUrl));
      } catch (err) {
        (req.log ?? logger).warn({ err }, 'invite unfurl failed');
      }
    }
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  };
}
