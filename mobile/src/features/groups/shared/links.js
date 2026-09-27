/** URL helpers for the links tab and descriptions. Pure (unit-tested). */

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING = /[).,;:!?\]}>'"’”]+$/;

/** Every http(s)/www link in `text`, trailing punctuation trimmed, in order, de-duplicated. */
export function extractLinks(text) {
  if (!text) return [];
  const out = [];
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    // Keep a closing paren that balances one inside the URL (Wikipedia-style links).
    while (TRAILING.test(url)) {
      const last = url[url.length - 1];
      if (last === ')' && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
      url = url.slice(0, -1);
    }
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** `www.x.com` → `https://www.x.com`; only http(s) links are ever returned. */
export function hrefOf(url) {
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Host without `www.` for display. */
export function hostOf(url) {
  const href = hrefOf(url);
  if (!href) return url;
  return new URL(href).hostname.replace(/^www\./, '');
}

/** Split text into plain and link parts (for linkified descriptions). */
export function linkify(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const [link] = extractLinks(m[0]);
    if (!link) continue;
    const href = hrefOf(link);
    if (!href) continue;
    const start = m.index;
    if (start > last) parts.push({ type: 'text', text: text.slice(last, start) });
    parts.push({ type: 'link', text: link, href });
    last = start + link.length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}
