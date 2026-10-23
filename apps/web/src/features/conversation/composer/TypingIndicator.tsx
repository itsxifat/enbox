/**
 * The typing line under the message box (Discord's): "Ann is typing…", "Ann and Bob are
 * typing…", "Several people are typing…" with three pulsing dots, from the chat's typing state
 * (`useTypingUsers`, the store the header and the chat list read; the words are
 * `typingParts`, features/threads/TypingLine). Names follow the Space's nicknames. The row
 * keeps its height while nobody types, so the conversation never jumps.
 */
import type { ReactNode } from 'react';
import type { ID } from '@enbox/shared';
import { typingParts } from '@/features/threads/TypingLine';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useTypingUsers } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { nameOf } from '@/stores/users';

const DOT_X = [3.5, 12.25, 21];

/** Three dots that swell and brighten in turn (still under reduced motion). */
export function TypingDots({ animate = true }: { animate?: boolean }) {
  return (
    <svg width="21" height="6" viewBox="0 0 24.5 7" className="shrink-0" aria-hidden>
      {DOT_X.map((cx, i) =>
        animate ? (
          <circle key={cx} cx={cx} cy="3.5" r="2.6" fill="currentColor" opacity="0.4">
            <animate
              attributeName="r"
              values="2.6;3.5;2.6"
              keyTimes="0;0.35;1"
              dur="1.2s"
              begin={`${i * 0.2}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.4;1;0.4"
              keyTimes="0;0.35;1"
              dur="1.2s"
              begin={`${i * 0.2}s`}
              repeatCount="indefinite"
            />
          </circle>
        ) : (
          <circle key={cx} cx={cx} cy="3.5" r="3" fill="currentColor" opacity="0.7" />
        ),
      )}
    </svg>
  );
}

function displayName(id: ID, spaceId: ID | null | undefined): string {
  const nick = spaceId ? useSpaces.getState().members[spaceId]?.[id]?.nickname : null;
  return nick || nameOf(id);
}

export function TypingIndicator({
  chatId,
  spaceId,
  className,
}: {
  chatId: ID;
  /** Names come from this Space's nicknames. */
  spaceId?: ID | null;
  className?: string;
}) {
  const typing = useTypingUsers(chatId);
  const still = useReducedMotion();
  const entries = Object.entries(typing);
  const parts = typingParts(
    entries.map(([id]) => displayName(id, spaceId)),
    entries.length > 0 && entries.every(([, t]) => t.state === 'recording'),
  );
  const line: ReactNode[] = [];
  parts?.names.forEach((n, i) => {
    if (i) line.push(parts.joiners[i - 1]);
    line.push(
      <strong key={`n${i}`} className="font-semibold text-fg">
        {n}
      </strong>,
    );
  });
  return (
    <div
      className={cn('flex h-5 shrink-0 items-center gap-1.5 text-[12.5px] text-muted', className)}
      data-testid="composer-typing"
    >
      {parts ? (
        <>
          <TypingDots animate={!still} />
          <span className="min-w-0 truncate">
            {line}
            {parts.tail}
          </span>
        </>
      ) : null}
    </div>
  );
}
