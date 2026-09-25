/** Message info (sender only, not channels): read by / delivered to / pending. */
import { useEffect, useState } from 'react';
import { CheckCheck, Clock3 } from 'lucide-react';
import { renderMentions, type MessageInfo, type UserPublic } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ListSection, PageSpinner, Sheet } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatChatListTime, formatTime } from '@/lib/format';
import { useChat } from '@/stores/chats';
import { userDisplayName } from '@enbox/shared';
import { PreviewLine, mentionName, previewParts } from '@/features/chats/preview';
import { useAuth } from '@/stores/auth';
import { useConversationUi } from './state';

function Person({ user, at }: { user: UserPublic; at?: string | null }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <UserAvatar user={user} size="md" />
      <span className="min-w-0 flex-1 truncate text-[15px]">{userDisplayName(user)}</span>
      {at ? (
        <span className="shrink-0 text-[13px] text-muted">
          {formatChatListTime(at)}
          {formatChatListTime(at) !== formatTime(at) ? `, ${formatTime(at)}` : ''}
        </span>
      ) : null}
    </li>
  );
}

export function MessageInfoSheet() {
  const m = useConversationUi((s) => s.info);
  const chat = useChat(m?.chatId);
  const me = useAuth((s) => s.user?.id);
  const [info, setInfo] = useState<MessageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const read = chat?.readWatermark;
  const delivered = chat?.deliveredWatermark;

  useEffect(() => {
    if (!m) {
      setInfo(null);
      setError(null);
      return;
    }
    let cancelled = false;
    api
      .get<MessageInfo>(`/api/messages/${m.id}/info`)
      .then((i) => !cancelled && setInfo(i))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
    // Refetch when ticks move while the sheet is open.
  }, [m, read, delivered]);

  const close = () => useConversationUi.getState().openInfo(null);
  return (
    <Sheet open={!!m} onClose={close} title="Message info">
      {m ? (
        <div className="flex flex-col">
          <div className="chat-wallpaper px-4 py-6">
            <div className="ml-auto max-w-[85%] rounded-lg bg-bubble-out px-3 py-2 text-[15px] text-fg shadow-bubble">
              {m.text ? (
                <p className="line-clamp-6 break-words whitespace-pre-wrap">
                  {renderMentions(m.text, mentionName)}
                </p>
              ) : (
                <PreviewLine parts={previewParts(m, { meId: me, chat })} />
              )}
              <p className="mt-1 text-right text-[11px] text-bubble-out-meta">
                {formatTime(m.createdAt)}
              </p>
            </div>
          </div>
          {error ? (
            <p className="px-4 py-6 text-center text-sm text-danger">{error}</p>
          ) : !info ? (
            <PageSpinner />
          ) : (
            <>
              <ListSection
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCheck size={16} className="text-tick-read" aria-hidden /> Read by
                  </span>
                }
              >
                {info.readBy.length ? (
                  <ul>
                    {info.readBy.map((r) => (
                      <Person key={r.user.id} user={r.user} at={r.at} />
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 pb-2 text-[13px] text-subtle">Nobody yet</p>
                )}
              </ListSection>
              <ListSection
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCheck size={16} aria-hidden /> Delivered to
                  </span>
                }
              >
                {info.deliveredTo.length ? (
                  <ul>
                    {info.deliveredTo.map((r) => (
                      <Person key={r.user.id} user={r.user} at={r.at} />
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 pb-2 text-[13px] text-subtle">Nobody else</p>
                )}
              </ListSection>
              {info.pending.length ? (
                <ListSection
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 size={15} aria-hidden /> Not delivered yet
                    </span>
                  }
                >
                  <ul>
                    {info.pending.map((u) => (
                      <Person key={u.id} user={u} />
                    ))}
                  </ul>
                </ListSection>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}
