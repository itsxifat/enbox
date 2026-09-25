import type { ReactNode } from 'react';
import { Logo, LogoMark } from '@/components/common/Logo';
import {
  CallsIcon,
  ChatsIcon,
  CommunitiesIcon,
  DoubleTickIcon,
  UpdatesIcon,
} from '@/components/icons';

const FEATURES = [
  { icon: ChatsIcon, text: 'Fast chats that stay in sync on every device' },
  { icon: CommunitiesIcon, text: 'Groups, communities and channels' },
  { icon: CallsIcon, text: 'Crystal-clear voice and video calls' },
  { icon: UpdatesIcon, text: 'Status updates that disappear after 24 hours' },
];

/** A little decorative conversation for the brand panel. */
function ChatPreview() {
  return (
    <div
      className="w-full max-w-sm rotate-[-2deg] rounded-3xl bg-white/10 p-4 shadow-2xl ring-1 ring-white/20 backdrop-blur-md"
      aria-hidden
    >
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-full bg-amber-400 text-sm font-semibold text-amber-950">
          MA
        </div>
        <div>
          <div className="text-sm font-semibold text-white">Maya</div>
          <div className="text-xs text-white/70">typing…</div>
        </div>
      </div>
      <div className="flex flex-col gap-2 text-[14px]">
        <div className="max-w-[80%] self-start rounded-2xl rounded-tl-md bg-white px-3 py-2 text-slate-800">
          Dinner tonight? 🍜
          <span className="ml-2 text-[11px] text-slate-400">19:02</span>
        </div>
        <div className="max-w-[80%] self-end rounded-2xl rounded-tr-md bg-violet-200 px-3 py-2 text-slate-900">
          Yes! See you at 8
          <span className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-slate-500">
            19:03 <DoubleTickIcon size={14} className="text-sky-500" />
          </span>
        </div>
        <div className="max-w-[80%] self-start rounded-2xl rounded-tl-md bg-white px-3 py-2 text-slate-800">
          Perfect, I&apos;ll book a table 🙌
          <span className="ml-2 text-[11px] text-slate-400">19:03</span>
        </div>
      </div>
    </div>
  );
}

/** Branded two-column auth frame (form only on phones). */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-surface">
      <aside className="relative hidden w-[46%] max-w-[720px] flex-col justify-between overflow-hidden bg-gradient-to-br from-violet-500 via-violet-600 to-violet-800 p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute -top-32 -right-32 size-96 rounded-full bg-white/10 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-40 -left-24 size-[28rem] rounded-full bg-violet-300/20 blur-3xl"
          aria-hidden
        />
        <Logo size={40} wordmarkClassName="text-white text-2xl" />
        <div className="relative flex flex-col gap-10">
          <div>
            <h1 className="max-w-md text-4xl leading-tight font-bold tracking-tight">
              All your conversations. One calm inbox.
            </h1>
            <ul className="mt-8 flex flex-col gap-3.5">
              {FEATURES.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-[15px] text-white/90">
                  <span className="flex size-8 items-center justify-center rounded-full bg-white/15">
                    <Icon size={18} aria-hidden />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <ChatPreview />
        </div>
        <p className="relative text-sm text-white/60">© {new Date().getFullYear()} Enbox</p>
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center px-5 pt-[max(40px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <LogoMark size={56} className="mb-6 drop-shadow-md lg:hidden" />
            <h2 className="text-[26px] font-bold tracking-tight text-fg">{title}</h2>
            {subtitle ? <p className="mt-2 text-[15px] text-muted">{subtitle}</p> : null}
          </div>
          {children}
          {footer ? <div className="mt-8 text-center text-[14px] text-muted">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
