/**
 * Discord's link warning: a link in a message to another site opens only after the "Leaving
 * Enbox" dialog has shown its full address ("Go back" / "Visit site"), with "Trust <domain>
 * links from now on" (the device pref `trustedLinkDomains`). Our own domains (bubbles/cards/
 * internalLinks.ts `ownOrigins`) and trusted ones — subdomains included — open at once, and
 * so does anything that isn't a web address (mail links). `linkHost` and `needsLinkWarning`
 * are pure (unit-tested).
 */
import { useState } from 'react';
import { Checkbox } from '@/components/ui';
import { confirm, useUi } from '@/stores/ui';
import { ownOrigins } from '@/features/conversation/bubbles/cards/internalLinks';

function webUrl(href: string): URL | null {
  try {
    const u = new URL(href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/** The domain a web link goes to, without "www." (null for anything else). */
export function linkHost(href: string): string | null {
  const host = webUrl(href)?.hostname.toLowerCase();
  return host ? host.replace(/^www\./, '') : null;
}

/** `host` is a trusted domain or one of its subdomains. */
export function isTrustedHost(host: string, trusted: readonly string[]): boolean {
  return trusted.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Whether opening `href` asks first: a web link to a site that is neither ours nor trusted. */
export function needsLinkWarning(
  href: string,
  trusted: readonly string[],
  own: Iterable<string> = ownOrigins(),
): boolean {
  const host = linkHost(href);
  if (!host) return false;
  for (const origin of own) if (linkHost(origin) === host) return false;
  return !isTrustedHost(host, trusted);
}

function LeavingBody({
  url,
  host,
  onTrust,
}: {
  url: string;
  host: string;
  onTrust: (trust: boolean) => void;
}) {
  const [trust, setTrust] = useState(false);
  return (
    <div className="flex flex-col gap-3" data-testid="leaving-dialog">
      <p>This link is taking you to the following website</p>
      <p className="rounded-lg bg-surface-2 px-3 py-2 text-[14px] break-all text-fg">{url}</p>
      <Checkbox
        checked={trust}
        onChange={(v) => {
          setTrust(v);
          onTrust(v);
        }}
        label={`Trust ${host} links from now on`}
      />
    </div>
  );
}

/**
 * Open a link to another site in a new tab, after the warning when it needs one. The real
 * address shows in full (punycode for look-alike domains), whatever the link's text said.
 */
export async function openExternalLink(href: string): Promise<void> {
  const url = webUrl(href);
  const host = linkHost(href);
  const { trustedLinkDomains } = useUi.getState().prefs;
  if (url && host && needsLinkWarning(href, trustedLinkDomains)) {
    let trust = false;
    const go = await confirm({
      title: 'Leaving Enbox',
      message: <LeavingBody url={url.href} host={host} onTrust={(v) => (trust = v)} />,
      confirmLabel: 'Visit site',
      cancelLabel: 'Go back',
    });
    if (!go) return;
    if (trust) {
      const list = useUi.getState().prefs.trustedLinkDomains;
      if (!list.includes(host)) useUi.getState().setPref('trustedLinkDomains', [...list, host]);
    }
  }
  window.open(url?.href ?? href, '_blank', 'noopener,noreferrer');
}
