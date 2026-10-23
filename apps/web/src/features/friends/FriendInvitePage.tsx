/**
 * A friend invite link at /friend/:code: whose link it is (GET /api/friend-invites/:code), then
 * Accept (POST …/accept) makes us friends, with Send Message and the Friends page after. My own
 * link says so; an expired, used-up or revoked link is "not valid". Anonymous visitors are sent
 * to /login?next=/friend/:code by the auth guard first.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Link2Off, RefreshCw, UserCheck } from 'lucide-react';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  userDisplayName,
  type FriendInvitePreview,
} from '@enbox/shared';
import { LogoMark } from '@/components/common/Logo';
import { StyledName } from '@/components/cosmetics';
import { ServerTagPill } from '@/components/cosmetics/TagPill/ServerTagPill';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Avatar, Button, EmptyState, Skeleton, toast } from '@/components/ui';
import { ensureDirectChat } from '@/features/calls/directChat';
import { ApiError, errorMessage } from '@/lib/api';
import { useMe } from '@/stores/auth';
import { acceptFriendInvite, previewFriendInvite } from './api';
import { expiresInText } from './FriendInviteLinks';

const CODE_RE = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; preview: FriendInvitePreview }
  | { status: 'invalid' }
  | { status: 'error'; message: string };

export function FriendInvitePage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  /** After Accept: we are friends (now or already). */
  const [done, setDone] = useState<'friends' | 'already_friends' | null>(null);

  useEffect(() => {
    if (!CODE_RE.test(code)) {
      setState({ status: 'invalid' });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    previewFriendInvite(code, ctrl.signal)
      .then((preview) => setState({ status: 'ready', preview }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 400))
          setState({ status: 'invalid' });
        else setState({ status: 'error', message: errorMessage(e) });
      });
    return () => ctrl.abort();
  }, [code, attempt]);

  const accept = async (preview: FriendInvitePreview) => {
    setBusy(true);
    try {
      const res = await acceptFriendInvite(code);
      setDone(res.status);
      if (res.status === 'friends')
        toast.success(`You and ${userDisplayName(preview.inviter)} are now friends`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState({ status: 'invalid' });
      else toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const message = async (userId: string) => {
    try {
      const chat = await ensureDirectChat(userId);
      void navigate(`/chats/${chat.id}`, { replace: true });
    } catch (e) {
      toast.error(e);
    }
  };

  let body: ReactNode;
  if (state.status === 'loading')
    body = (
      <div
        className="flex flex-col items-center gap-3 py-2"
        role="status"
        aria-label="Loading invite"
      >
        <Skeleton circle className="size-24" />
        <Skeleton className="mt-2 h-6 w-44" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-11 w-full rounded-full" />
      </div>
    );
  else if (state.status === 'invalid')
    body = (
      <EmptyState
        icon={Link2Off}
        title="This invite link isn't valid"
        description="It may have expired, been used up or been revoked. Ask your friend for a new link."
        action={
          <Button variant="soft" onClick={() => void navigate('/chats')}>
            Go to Friends
          </Button>
        }
      />
    );
  else if (state.status === 'error')
    body = (
      <EmptyState
        icon={RefreshCw}
        title="Couldn't open the invite"
        description={state.message}
        action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
      />
    );
  else {
    const { inviter } = state.preview;
    const name = userDisplayName(inviter);
    const own = inviter.id === me?.id;
    body = (
      <div className="flex flex-col items-center text-center" data-testid="friend-invite-preview">
        <span className="text-[13px] font-semibold tracking-wide text-brand-ink uppercase">
          {own ? 'Your invite link' : 'Friend invite'}
        </span>
        <Avatar
          src={inviter.avatarUrl}
          animatedSrc={inviter.avatarAnimatedUrl}
          animate="always"
          decoration={inviter.avatarDecoration}
          name={name}
          colorSeed={inviter.id}
          size={96}
          className="mt-5"
        />
        <h1 className="mt-4 text-[24px] leading-tight font-semibold text-fg">
          <StyledName name={name} style={inviter.nameStyle} mode="full" />
          <ServerTagPill
            userId={inviter.id}
            tag={inviter.spaceTag ?? null}
            size="md"
            className="ml-1.5"
          />
        </h1>
        <p className="mt-1 text-[15px] text-muted">@{inviter.username}</p>
        <div className="mt-6 w-full">
          {own ? (
            <p className="text-[14px] text-muted">
              Share this link: whoever opens it becomes your friend.
              <span className="mt-1 block">{expiresInText(state.preview.expiresAt)}.</span>
            </p>
          ) : done ? (
            <>
              <p
                className="mb-3 flex items-center justify-center gap-2 text-[14px] text-success"
                role="status"
              >
                <UserCheck size={18} aria-hidden />
                {done === 'friends'
                  ? `You and ${name} are now friends.`
                  : `You're already friends with ${name}.`}
              </p>
              <div className="flex flex-col gap-2">
                <Button fullWidth size="lg" onClick={() => void message(inviter.id)}>
                  Send Message
                </Button>
                <Button
                  fullWidth
                  variant="ghost"
                  onClick={() => void navigate('/chats', { replace: true })}
                >
                  Go to Friends
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-3 text-[14px] text-muted">
                {name} invited you to be friends. {expiresInText(state.preview.expiresAt)}.
              </p>
              <Button fullWidth size="lg" loading={busy} onClick={() => void accept(state.preview)}>
                Accept Invite
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app">
      <PaneHeader title="Friend invite" back="/chats" />
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-8 sm:items-center">
        <div className="w-full max-w-md">
          <div className="rounded-3xl bg-surface p-6 shadow-elevated sm:p-8">{body}</div>
          <p className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-subtle">
            <LogoMark size={16} /> Only accept friend invites from people you know.
          </p>
        </div>
      </div>
    </div>
  );
}
