/** Invite-link helpers: absolute join URL, copy and native share (with copy fallback). */
import { toast } from '@/components/ui';

/** Absolute `/join/:code` URL on this origin. */
export function inviteUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/join/${code}`;
}

/** Copy text to the clipboard (with a textarea fallback for insecure contexts). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function copyLink(url: string, what = 'Link'): Promise<void> {
  if (await copyText(url)) toast.success(`${what} copied`);
  else toast.error("Couldn't copy. Select the link and copy it manually.");
}

/**
 * Run after the next two frames. Used to open anchored menus from list rows: the Menu closes
 * on any scroll, and a click on a partially visible row scrolls its container (focus /
 * scroll-into-view) with the scroll event dispatched on the next frame.
 */
export function afterPaint(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/** Native share sheet when available (phones), else copy. */
export async function shareLink(opts: {
  title: string;
  text?: string;
  url: string;
}): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const data: ShareData = { title: opts.title, text: opts.text, url: opts.url };
  if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data);
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  await copyLink(opts.url);
}
