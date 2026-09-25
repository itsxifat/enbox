/**
 * Invite landing at /join/:code — preview (GET /api/invites/:code) with community context,
 * then Join / Follow (POST /api/invites/:code/join) and open the chat, channel or community.
 * Anonymous visitors are sent to /login?next=/join/:code by the auth guard first.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Link2Off, Megaphone, RefreshCw, UsersRound } from 'lucide-react';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  type InviteJoinResult,
  type InvitePreview,
} from '@enbox/shared';
import { LogoMark } from '@/components/common/Logo';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Avatar, Button, EmptyState, Skeleton, toast } from '@/components/ui';
import { RichText } from '@/features/groups/shared/RichText';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { useChats } from '@/stores/chats';
import { useCommunities } from '@/stores/communities';

const CODE_RE = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

/** Where to go for a joined/previewed invite target. */
export function invitePath(kind: InvitePreview['kind'], id: string): string {
  if (kind === 'channel') return `/updates/channels/${id}`;
  if (kind === 'community') return `/communities/${id}`;
  return `/chats/${id}`;
}

const NOUN: Record<InvitePreview['kind'], string> = {
  group: 'Group',
  community: 'Community',
  channel: 'Channel',
};

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; preview: InvitePreview }
  | { status: 'invalid' }
  | { status: 'error'; message: string };

export function JoinInvitePage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!CODE_RE.test(code)) {
      setState({ status: 'invalid' });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    api
      .get<InvitePreview>(`/api/invites/${code}`, { signal: ctrl.signal })
      .then((preview) => setState({ status: 'ready', preview }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 400))
          setState({ status: 'invalid' });
        else setState({ status: 'error', message: errorMessage(e) });
      });
    return () => ctrl.abort();
  }, [code, attempt]);

  const join = async (preview: InvitePreview) => {
    setJoining(true);
    try {
      const r = await api.post<InviteJoinResult>(`/api/invites/${code}/join`);
      if (r.chat) useChats.getState().upsertChat(r.chat);
      if (r.community) useCommunities.getState().upsertCommunity(r.community);
      toast.success(
        preview.kind === 'channel'
          ? `You're following ${preview.name}`
          : `You joined “${preview.name}”`,
      );
      void navigate(invitePath(r.kind, r.id), { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        // Already a member/follower (e.g. joined on another device): just open it.
        void navigate(invitePath(preview.kind, preview.id), { replace: true });
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        setState({ status: 'invalid' });
        return;
      }
      toast.error(e);
      setAttempt((n) => n + 1);
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app">
      <PaneHeader title="Invite link" back="/chats" border />
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-8 sm:items-center">
        <div className="w-full max-w-md">
          {state.status === 'loading' ? (
            <Card>
              <div
                className="flex flex-col items-center gap-3 py-2"
                role="status"
                aria-label="Loading invite"
              >
                <Skeleton circle className="size-28" />
                <Skeleton className="mt-2 h-6 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-4 h-11 w-full rounded-full" />
              </div>
            </Card>
          ) : state.status === 'invalid' ? (
            <Card>
              <EmptyState
                icon={Link2Off}
                title="This invite link isn't valid"
                description="It may have been reset by an admin, or the group, channel or community no longer exists. Ask for a new link."
                action={
                  <Button variant="soft" onClick={() => void navigate('/chats')}>
                    Go to chats
                  </Button>
                }
              />
            </Card>
          ) : state.status === 'error' ? (
            <Card>
              <EmptyState
                icon={RefreshCw}
                title="Couldn't open the invite"
                description={state.message}
                action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
              />
            </Card>
          ) : (
            <PreviewCard
              preview={state.preview}
              joining={joining}
              onJoin={() => void join(state.preview)}
              onOpen={() => void navigate(invitePath(state.preview.kind, state.preview.id))}
            />
          )}
          <p className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-subtle">
            <LogoMark size={16} /> Invites on Enbox are private links. Only join groups you trust.
          </p>
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-3xl bg-surface p-6 shadow-elevated sm:p-8">{children}</div>;
}

function PreviewCard({
  preview: p,
  joining,
  onJoin,
  onOpen,
}: {
  preview: InvitePreview;
  joining: boolean;
  onJoin: () => void;
  onOpen: () => void;
}) {
  const noun = NOUN[p.kind];
  const count =
    p.kind === 'channel'
      ? `${formatCount(p.memberCount)} ${p.memberCount === 1 ? 'follower' : 'followers'}`
      : `${formatCount(p.memberCount)} ${p.memberCount === 1 ? 'member' : 'members'}`;
  const cta = p.kind === 'channel' ? 'Follow channel' : `Join ${noun.toLowerCase()}`;
  return (
    <Card>
      <div className="flex flex-col items-center text-center" data-testid="invite-preview">
        <span className="text-[13px] font-semibold tracking-wide text-brand-ink uppercase">
          {p.isMember
            ? `${noun} invite`
            : p.kind === 'channel'
              ? "You're invited to follow"
              : "You're invited to join"}
        </span>
        <Avatar
          src={p.avatarUrl}
          name={p.name}
          colorSeed={p.id}
          kind={p.kind === 'community' ? 'community' : p.kind === 'channel' ? 'channel' : 'group'}
          size={112}
          className="mt-5"
        />
        <h1 className="mt-4 text-[24px] leading-tight font-semibold text-fg">{p.name}</h1>
        <p className="mt-1 text-[15px] text-muted">
          {noun} · {count}
        </p>
        {p.communityName ? (
          <div className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-left">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[28%] bg-brand-soft text-brand-ink">
              <UsersRound size={20} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] text-fg">
                Part of <span className="font-semibold">{p.communityName}</span>
              </span>
              <span className="block text-[12.5px] text-muted">
                Joining also makes you a member of this community.
              </span>
            </span>
          </div>
        ) : null}
        {p.description ? (
          <div className="mt-4 max-h-40 w-full overflow-y-auto text-[14.5px] leading-relaxed text-muted">
            <RichText text={p.description} />
          </div>
        ) : null}
        <div className="mt-6 w-full">
          {p.isMember ? (
            <>
              <p className="mb-3 text-[14px] text-muted">
                {p.kind === 'channel'
                  ? "You're already following this channel."
                  : `You're already a member.`}
              </p>
              <Button fullWidth size="lg" onClick={onOpen}>
                Open {noun.toLowerCase()}
              </Button>
            </>
          ) : p.canJoin ? (
            <Button
              fullWidth
              size="lg"
              loading={joining}
              onClick={onJoin}
              leftIcon={p.kind === 'channel' ? Megaphone : undefined}
            >
              {cta}
            </Button>
          ) : (
            <>
              <p
                role="alert"
                className="mb-3 rounded-2xl bg-danger-soft px-4 py-3 text-[14px] text-danger"
              >
                {p.reason ?? `You can't join this ${noun.toLowerCase()}.`}
              </p>
              <Button fullWidth size="lg" disabled>
                {cta}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
