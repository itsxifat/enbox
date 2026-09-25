/**
 * Invite link page (groups, channels, communities): shows the `/join/:code` link with copy,
 * share and (admins) reset. Rendered inside a panel with its own header.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Copy, Link2, RotateCcw, Share2 } from 'lucide-react';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Skeleton, confirm, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { InfoPage, InfoRow, InfoSection } from './InfoLayout';
import { copyLink, inviteUrl, shareLink } from './share';

export interface InviteLinkViewProps {
  title?: string;
  /** Name of the group/channel/community (share text). */
  name: string;
  avatar: ReactNode;
  kind: 'group' | 'channel' | 'community';
  /** Known code (e.g. `chat.inviteCode`); fetched with `load` when null. */
  code: string | null;
  load: () => Promise<{ code: string }>;
  /** Admins only. */
  reset?: () => Promise<{ code: string }>;
  onBack: () => void;
  backIcon?: 'arrow' | 'close';
}

export function InviteLinkView({
  title = 'Invite link',
  name,
  avatar,
  kind,
  code: initial,
  load,
  reset,
  onBack,
  backIcon = 'arrow',
}: InviteLinkViewProps) {
  const [code, setCode] = useState<string | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (initial) {
      setCode(initial);
      return;
    }
    let alive = true;
    load()
      .then((r) => alive && setCode(r.code))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
    // `load` is a fresh closure every render; fetch once per code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const url = code ? inviteUrl(code) : '';
  const noun = kind === 'channel' ? 'channel' : kind === 'community' ? 'community' : 'group';
  const verb = kind === 'channel' ? 'follow' : 'join';

  const doReset = async () => {
    if (!reset) return;
    const ok = await confirm({
      title: 'Reset link?',
      message: `The current link will stop working. Anyone who tries to use it won't be able to ${verb} this ${noun}.`,
      confirmLabel: 'Reset link',
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      const r = await reset();
      setCode(r.code);
      toast.success('Invite link reset');
    } catch (e) {
      toast.error(e);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PaneHeader title={title} back={onBack} backIcon={backIcon} border />
      <InfoPage>
        <InfoSection className="px-5 py-5">
          <div className="flex items-center gap-4">
            {avatar}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-semibold text-fg">{name}</p>
              {code ? (
                <a
                  href={url}
                  onClick={(e) => e.preventDefault()}
                  className="mt-0.5 block text-[14px] break-all text-brand-ink select-all"
                  data-testid="invite-link"
                >
                  {url}
                </a>
              ) : error ? (
                <p className="mt-0.5 text-[14px] text-danger">{error}</p>
              ) : (
                <Skeleton className="mt-1.5 h-4 w-4/5" />
              )}
            </div>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            Anyone with Enbox can use this link to {verb} this {noun}. Only share it with people you
            trust.
          </p>
        </InfoSection>
        <InfoSection>
          <InfoRow
            icon={Copy}
            label="Copy link"
            disabled={!code}
            onClick={() => void copyLink(url)}
            chevron={false}
          />
          <InfoRow
            icon={Share2}
            label="Share link"
            disabled={!code}
            onClick={() =>
              void shareLink({
                title: name,
                text: `Follow this link to ${verb} my Enbox ${noun} “${name}”`,
                url,
              })
            }
            chevron={false}
          />
          {reset ? (
            <InfoRow
              icon={resetting ? Link2 : RotateCcw}
              label={resetting ? 'Resetting…' : 'Reset link'}
              danger
              disabled={!code || resetting}
              onClick={() => void doReset()}
            />
          ) : null}
        </InfoSection>
      </InfoPage>
    </div>
  );
}
