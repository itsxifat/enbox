/**
 * PLACEHOLDER (agent 4 owns this file): global call UI slot, rendered once by AppShell
 * above everything. Shows the incoming-call prompt (`useCalls().incoming`) and, later, the
 * active call screen / minimized PiP (`useCalls().active`).
 */
import { useEffect } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { chatTitle } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { IconButton, Portal } from '@/components/ui';
import { startLoop, vibrate } from '@/lib/notify';
import { useCalls } from '@/stores/calls';

export function CallOverlay() {
  const incoming = useCalls((s) => s.incoming);

  useEffect(() => {
    if (!incoming) return;
    const stop = startLoop('ringtone');
    vibrate([400, 200, 400]);
    return stop;
  }, [incoming]);

  if (!incoming) return null;
  const video = incoming.call.type === 'video';
  const title =
    incoming.chat.type === 'direct' ? chatTitle(incoming.chat) : `${chatTitle(incoming.chat)}`;
  return (
    <Portal>
      <div
        role="alertdialog"
        aria-label={`Incoming ${video ? 'video' : 'voice'} call from ${title}`}
        className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-[80] mx-auto flex max-w-md animate-slide-down items-center gap-3 rounded-3xl bg-violet-950 p-3 pr-4 text-white shadow-elevated"
      >
        <UserAvatar user={incoming.caller} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold">{title}</p>
          <p className="text-[13px] text-white/70">Incoming {video ? 'video' : 'voice'} call…</p>
        </div>
        <IconButton
          icon={PhoneOff}
          label="Decline"
          variant="danger"
          size="lg"
          onClick={() => useCalls.getState().declineIncoming()}
        />
        <IconButton
          icon={video ? Video : Phone}
          label="Accept"
          variant="success"
          size="lg"
          onClick={() => void useCalls.getState().acceptIncoming()}
        />
      </div>
    </Portal>
  );
}
