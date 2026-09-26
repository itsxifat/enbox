/**
 * "Ongoing call" banner for the top of a group conversation (agent 2 renders
 * `<OngoingCallBanner chatId={chat.id} />` under the header). Shows the live group call with
 * who's in it and a Join / Return button; renders nothing when there is no live call.
 */
import { Phone } from 'lucide-react';
import type { ID } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { VideoIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useActiveCallForChat } from './hooks';
import { joinedOthers } from './logic';
import { useCallDuration } from './ui/hooks';

export function OngoingCallBanner({ chatId, className }: { chatId: ID; className?: string }) {
  const state = useActiveCallForChat(chatId);
  const me = useMe()?.id ?? '';
  const connectedAt = useCalls((s) => (state.inCallHere ? (s.active?.connectedAt ?? null) : null));
  const duration = useCallDuration(connectedAt);
  const { call } = state;
  if (!call || (!call.isGroup && !state.inCallHere)) return null;
  if (!state.inCallHere && !state.canJoin && !state.inCallElsewhere) return null;

  const video = call.type === 'video';
  const Icon = video ? VideoIcon : Phone;
  const joined = joinedOthers(call, me);
  const label = state.inCallHere
    ? `You're in this call${duration ? ` · ${duration}` : ''}`
    : state.inCallElsewhere
      ? "You're in this call on another device"
      : `${video ? 'Video' : 'Voice'} call in progress · ${state.joinedCount} joined`;

  return (
    <div
      role="region"
      aria-label="Ongoing call"
      data-testid="ongoing-call-banner"
      className={cn(
        'flex shrink-0 items-center gap-3 border-b border-line bg-success-soft px-4 py-2 text-fg',
        className,
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success text-white">
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{label}</p>
        {joined.length ? (
          <div className="mt-0.5 flex -space-x-1.5" aria-hidden>
            {joined.slice(0, 5).map((p) => (
              <UserAvatar
                key={p.userId}
                userId={p.userId}
                size={20}
                className="rounded-full ring-2 ring-success-soft"
              />
            ))}
          </div>
        ) : null}
      </div>
      {state.inCallHere ? (
        <button
          type="button"
          onClick={() => useCalls.getState().setMinimized(false)}
          className="h-8 shrink-0 rounded-full bg-success px-4 text-[14px] font-semibold text-white hover:brightness-110"
        >
          Return
        </button>
      ) : state.canJoin ? (
        <button
          type="button"
          onClick={() => void useCalls.getState().joinCall(call.id)}
          className="h-8 shrink-0 rounded-full bg-success px-4 text-[14px] font-semibold text-white hover:brightness-110"
        >
          Join
        </button>
      ) : null}
    </div>
  );
}
