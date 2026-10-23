/**
 * Over the composer of a message request (ConversationPane): who wants to talk, the Spaces we
 * share, and Accept / Ignore / Block / Report. The composer stays: sending a reply accepts.
 * Ignoring or blocking leaves for the Requests list.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { userDisplayName, type ChatSummary } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui';
import {
  acceptRequest,
  blockRequester,
  ignoreRequest,
  mutualSpacesText,
  reportRequester,
  useMutualSpaceCount,
} from './actions';

export function RequestBanner({ chat }: { chat: ChatSummary }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const peer = chat.peer;
  const name = userDisplayName(peer);
  const mutuals = mutualSpacesText(useMutualSpaceCount(peer?.id));
  const pending = chat.request === 'pending';
  const run = (fn: (c: ChatSummary) => Promise<boolean>, leave: boolean) => async () => {
    setBusy(true);
    const ok = await fn(chat);
    setBusy(false);
    if (ok && leave) void navigate('/message-requests', { replace: true });
  };
  return (
    <section
      aria-label="Message request"
      className="card-inset mx-3 mb-2 flex flex-col gap-3 px-4 py-3 sm:mx-4"
      data-testid="request-banner"
    >
      <div className="flex items-center gap-3">
        {peer ? <UserAvatar user={peer} size={40} /> : null}
        <div className="min-w-0 flex-1 leading-snug">
          <p className="truncate text-[15px] font-semibold text-fg">
            {pending ? `${name} wants to message you` : `You ignored ${name}’s message request`}
          </p>
          <p className="text-[13px] text-muted">
            {mutuals ? `${mutuals} · ` : ''}
            They won’t know you’ve seen this until you accept or reply. Replying accepts.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void run(acceptRequest, false)()}>
          Accept
        </Button>
        {pending ? (
          <Button
            size="sm"
            variant="soft"
            disabled={busy}
            onClick={() => void run(ignoreRequest, true)()}
          >
            Ignore
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="text-danger"
          disabled={busy || !peer}
          onClick={() => void run(blockRequester, true)()}
        >
          Block
        </Button>
        <Button size="sm" variant="ghost" disabled={!peer} onClick={() => reportRequester(chat)}>
          Report
        </Button>
      </div>
    </section>
  );
}
