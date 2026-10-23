/**
 * /message-requests (Home): DMs from people who aren't my friends, waiting for an answer.
 * Requests (pending) and Ignored tabs; a row shows who, how many Spaces we share, the last
 * message and when, with Accept and Ignore (Ignored: Accept). The row opens the chat, where
 * a banner over the composer offers the same plus Block and Report (RequestBanner).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, EyeOff, MailQuestionMark } from 'lucide-react';
import { userDisplayName, type ChatSummary } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { StyledName } from '@/components/cosmetics';
import { Badge, Button, EmptyState, IconButton } from '@/components/ui';
import { PreviewLine, previewParts } from '@/features/chats/preview';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { formatChatListTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import {
  useIgnoredRequests,
  usePendingRequestCount,
  usePendingRequests,
  useRequests,
} from '@/stores/requests';
import { acceptRequest, ignoreRequest, mutualSpacesText, useMutualSpaceCount } from './actions';

type Tab = 'pending' | 'ignored';

/** Rows past this many show the mutual Spaces hint only once their profile is cached. */
const MUTUALS_LOOKUPS = 20;

const ROW =
  'group/request mx-3 flex min-h-[68px] items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover lg:mx-5';

export function RequestRow({
  chat,
  lookUpMutuals = true,
}: {
  chat: ChatSummary;
  lookUpMutuals?: boolean;
}) {
  const navigate = useNavigate();
  const meId = useAuth((s) => s.user?.id);
  const [busy, setBusy] = useState(false);
  const peer = chat.peer;
  const mutuals = mutualSpacesText(useMutualSpaceCount(peer?.id, lookUpMutuals));
  const name = userDisplayName(peer);
  const pending = chat.request === 'pending';
  const act = (fn: (c: ChatSummary) => Promise<boolean>) => async () => {
    setBusy(true);
    // The row goes away on success; it stays (and toasts) on failure.
    if (!(await fn(chat))) setBusy(false);
  };
  return (
    <div className={ROW} data-testid="request-row" data-animate-avatars>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => void navigate(`/chats/${chat.id}`)}
        aria-label={`Open the request from ${name}`}
      >
        {peer ? <UserAvatar user={peer} size="md" /> : null}
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-baseline gap-2">
            <StyledName
              name={name}
              style={peer?.nameStyle}
              mode="full"
              className="min-w-0 truncate text-[16px] font-semibold text-fg"
            />
            <span className="ml-auto shrink-0 text-[12px] text-subtle">
              {formatChatListTime(chat.lastActivityAt)}
            </span>
          </span>
          {chat.lastMessage ? (
            <PreviewLine
              parts={previewParts(chat.lastMessage, { meId, chat })}
              className="text-[14px] text-muted"
            />
          ) : null}
          {mutuals ? (
            <span className="block truncate text-[12px] text-subtle">{mutuals}</span>
          ) : null}
        </span>
      </button>
      {pending ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(ignoreRequest)()}>
          Ignore
        </Button>
      ) : null}
      <Button size="sm" disabled={busy} onClick={() => void act(acceptRequest)()}>
        Accept
      </Button>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-5 mb-2 px-5 text-[12px] font-semibold tracking-wide text-muted uppercase lg:px-8">
      {children}
    </h2>
  );
}

export function MessageRequestsPage() {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const [tab, setTab] = useState<Tab>('pending');
  const loaded = useRequests((s) => s.loaded);
  const pending = usePendingRequests();
  const ignored = useIgnoredRequests();
  const pendingCount = usePendingRequestCount();

  // Fresh on every visit (the socket keeps it live meanwhile).
  useEffect(() => {
    void useRequests.getState().load();
  }, []);

  const list = tab === 'pending' ? pending : ignored;
  let body: ReactNode;
  if (!loaded && !list.length) body = null;
  else if (!list.length)
    body =
      tab === 'pending' ? (
        <EmptyState
          icon={MailQuestionMark}
          title="No message requests"
          description="Messages from people you may not know wait here until you accept them."
        />
      ) : (
        <EmptyState
          icon={EyeOff}
          title="No ignored requests"
          description="Requests you ignore move here. They aren’t told."
        />
      );
  else
    body = (
      <section aria-label={tab === 'pending' ? 'Message requests' : 'Ignored requests'}>
        <SectionHeading>
          {tab === 'pending' ? 'Pending' : 'Ignored'} — {list.length}
        </SectionHeading>
        {list.map((c, i) => (
          <RequestRow key={c.id} chat={c} lookUpMutuals={i < MUTUALS_LOOKUPS} />
        ))}
      </section>
    );

  const tabs: { id: Tab; label: string }[] = [
    { id: 'pending', label: 'Requests' },
    { id: 'ignored', label: 'Ignored' },
  ];
  const tablist = (
    <div role="tablist" aria-label="Message requests" className="flex items-center gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => setTab(t.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[15px] font-medium',
            tab === t.id ? 'bg-selected text-fg' : 'text-muted hover:bg-hover hover:text-fg',
          )}
        >
          {t.label}
          {t.id === 'pending' && pendingCount ? (
            <Badge count={pendingCount} size="sm" tone="danger" />
          ) : null}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="message-requests-page">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        {desktop ? null : (
          <IconButton
            icon={ArrowLeft}
            label="Back"
            variant="ghost"
            size="sm"
            onClick={() => void navigate('/chats')}
          />
        )}
        <MailQuestionMark size={22} className="text-muted" aria-hidden />
        <h1 className="truncate text-[16px] font-semibold text-fg">Message Requests</h1>
        {desktop ? (
          <>
            <span className="mx-1 size-1 rounded-full bg-subtle" aria-hidden />
            {tablist}
          </>
        ) : null}
      </header>
      {/* Phones: the tabs get their own row. */}
      {desktop ? null : <div className="px-3 pb-1">{tablist}</div>}
      <p className="px-5 pt-3 text-[13px] text-muted lg:px-8">
        Messages from people you may not know. They won’t know you’ve seen them until you accept or
        reply.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4 scrollbar-thin">{body}</div>
    </div>
  );
}
