/**
 * Incoming call UIs: full-screen ringing screen (phones), floating card (desktop), the
 * "silenced" variant (unknown caller, no ringtone) and the call-waiting card shown on top of
 * an active call.
 */
import { useEffect, useRef, useState } from 'react';
import { BellOff, Phone, PhoneOff, Video, X } from 'lucide-react';
import { chatTitle, userDisplayName, type IncomingCallPayload } from '@enbox/shared';
import { Portal } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useCalls } from '@/stores/calls';
import { CallAvatar } from './CallAvatar';
import { CallButton } from './CallButton';
import { CALL_BG } from './CallScreen';
import '../calls.css';

function describe(p: IncomingCallPayload) {
  const video = p.call.type === 'video';
  const caller = userDisplayName(p.caller);
  const group = p.chat.type !== 'direct';
  return {
    video,
    caller,
    group,
    title: group ? chatTitle(p.chat) : caller,
    subtitle: group
      ? `${caller} · Group ${video ? 'video' : 'voice'} call`
      : `Enbox ${video ? 'video' : 'voice'} call`,
    avatar: group
      ? { src: p.chat.avatarUrl, name: chatTitle(p.chat), seed: p.chat.id, kind: 'group' as const }
      : { src: p.caller.avatarUrl, name: caller, seed: p.caller.id, kind: 'user' as const },
  };
}

const accept = () => void useCalls.getState().acceptIncoming();
const decline = () => useCalls.getState().declineIncoming();

export function IncomingCallScreen({ payload }: { payload: IncomingCallPayload }) {
  const desktop = useIsDesktop();
  const d = describe(payload);
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!desktop) return;
    const raf = requestAnimationFrame(() => acceptRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [payload.call.id, desktop]);

  if (desktop) {
    return (
      <Portal>
        <div
          role="alertdialog"
          aria-label={`Incoming ${d.video ? 'video' : 'voice'} call from ${d.title}`}
          data-testid="incoming-call"
          className={cn(
            'fixed top-5 right-5 z-[58] w-[360px] animate-slide-down overflow-hidden rounded-3xl text-white shadow-2xl ring-1 ring-white/10',
            CALL_BG,
          )}
        >
          <div className="flex items-center gap-4 p-5 pb-4">
            <span className="relative">
              <span
                className="absolute inset-0 animate-ping rounded-full bg-violet-400/25 [animation-duration:1.8s]"
                aria-hidden
              />
              <CallAvatar
                src={d.avatar.src}
                name={d.avatar.name}
                seed={d.avatar.seed}
                group={d.group}
                size={64}
                className="relative"
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[17px] font-semibold">{d.title}</p>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-white/70">
                {d.video ? <Video size={14} aria-hidden /> : <Phone size={14} aria-hidden />}
                {d.subtitle}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 px-5 pb-5">
            <button
              type="button"
              onClick={decline}
              className="flex h-11 items-center justify-center gap-2 rounded-full bg-[#ef4444] text-[15px] font-semibold hover:bg-[#dc2626] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <PhoneOff size={18} aria-hidden /> Decline
            </button>
            <button
              ref={acceptRef}
              type="button"
              onClick={accept}
              className="flex h-11 items-center justify-center gap-2 rounded-full bg-[#22c55e] text-[15px] font-semibold hover:bg-[#16a34a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {d.video ? <Video size={18} aria-hidden /> : <Phone size={18} aria-hidden />} Accept
            </button>
          </div>
        </div>
      </Portal>
    );
  }

  return (
    <Portal>
      <div
        role="alertdialog"
        aria-label={`Incoming ${d.video ? 'video' : 'voice'} call from ${d.title}`}
        data-testid="incoming-call"
        className={cn('fixed inset-0 z-[58] flex animate-fade-in flex-col text-white', CALL_BG)}
      >
        <div className="flex flex-1 flex-col items-center px-6 pt-[calc(env(safe-area-inset-top)+64px)] text-center">
          <p className="flex items-center gap-1.5 text-[14px] text-white/70">
            {d.video ? <Video size={15} aria-hidden /> : <Phone size={15} aria-hidden />}
            {d.subtitle}
          </p>
          <h2 className="mt-2 max-w-full truncate text-[30px] font-semibold tracking-tight">
            {d.title}
          </h2>
          <p className="mt-1 text-[15px] text-white/70">Incoming call…</p>
          <div className="flex flex-1 items-center justify-center">
            <span className="relative">
              <span
                className="absolute inset-0 animate-ping rounded-full bg-violet-400/20 [animation-duration:2s]"
                aria-hidden
              />
              <span className="absolute -inset-8 rounded-full border border-white/10" aria-hidden />
              <span className="absolute -inset-16 rounded-full border border-white/5" aria-hidden />
              <CallAvatar
                src={d.avatar.src}
                name={d.avatar.name}
                seed={d.avatar.seed}
                group={d.group}
                size={144}
                className="relative"
              />
            </span>
          </div>
        </div>
        <div className="flex items-start justify-around px-10 pt-6 pb-[max(48px,calc(env(safe-area-inset-bottom)+32px))]">
          <CallButton
            icon={PhoneOff}
            label="Decline"
            caption="Decline"
            tone="danger"
            size="xl"
            onClick={decline}
          />
          <CallButton
            ref={acceptRef}
            icon={d.video ? Video : Phone}
            label="Accept"
            caption="Accept"
            tone="success"
            size="xl"
            onClick={accept}
            className="[&>button]:animate-[call-bounce_1.6s_ease-in-out_infinite]"
          />
        </div>
      </div>
    </Portal>
  );
}

/** Unknown caller while "Silence unknown callers" is on: no ringtone, answer if you like. */
export function SilencedCallCard({ payload }: { payload: IncomingCallPayload }) {
  const d = describe(payload);
  return (
    <Portal>
      <div
        role="status"
        data-testid="incoming-call-silenced"
        className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-[58] mx-auto flex max-w-md animate-slide-down items-center gap-3 rounded-2xl bg-elevated p-3 pr-2 text-fg shadow-elevated ring-1 ring-line sm:right-5 sm:left-auto sm:mx-0 sm:w-[380px]"
      >
        <CallAvatar
          src={d.avatar.src}
          name={d.avatar.name}
          seed={d.avatar.seed}
          group={d.group}
          size={44}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{d.title}</p>
          <p className="flex items-center gap-1 truncate text-[12.5px] text-muted">
            <BellOff size={13} aria-hidden /> Silenced unknown caller
          </p>
        </div>
        <button
          type="button"
          onClick={accept}
          className="h-9 rounded-full bg-success px-3.5 text-[14px] font-semibold text-white hover:brightness-110"
        >
          Answer
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => useCalls.getState().setIncoming(null)}
          className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg"
        >
          <X size={18} aria-hidden />
        </button>
      </div>
    </Portal>
  );
}

/** Someone calls while I'm already in a call. */
export function CallWaitingCard({ payload }: { payload: IncomingCallPayload }) {
  const d = describe(payload);
  const [busy, setBusy] = useState(false);
  return (
    <Portal>
      <div
        role="alertdialog"
        aria-label={`${d.title} is calling`}
        data-testid="call-waiting"
        className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+72px)] z-[58] mx-auto flex max-w-md animate-slide-down flex-col gap-3 rounded-2xl bg-white/12 p-3 text-white shadow-2xl ring-1 ring-white/15 backdrop-blur-xl"
      >
        <div className="flex items-center gap-3">
          <CallAvatar
            src={d.avatar.src}
            name={d.avatar.name}
            seed={d.avatar.seed}
            group={d.group}
            size={40}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{d.title}</p>
            <p className="truncate text-[12.5px] text-white/70">{d.subtitle}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={decline}
            className="h-9 rounded-full bg-[#ef4444] text-[14px] font-semibold hover:bg-[#dc2626]"
          >
            Decline
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              accept();
            }}
            className="h-9 rounded-full bg-[#22c55e] text-[14px] font-semibold hover:bg-[#16a34a] disabled:opacity-60"
          >
            End & accept
          </button>
        </div>
      </div>
    </Portal>
  );
}
