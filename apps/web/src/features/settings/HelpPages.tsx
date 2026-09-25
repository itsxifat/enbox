import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronDown, Database, HardDrive, Keyboard, Trash2, Upload } from 'lucide-react';
import { APP_NAME, formatBytes } from '@enbox/shared';
import { LogoMark } from '@/components/common/Logo';
import { Spinner, confirm, toast } from '@/components/ui';
import { getServerConfig } from '@/lib/push';
import { SettingsGroup, SettingsNote, SettingsRow, SettingsScroller } from './ui';

type ServerConfig = Awaited<ReturnType<typeof getServerConfig>>;

function useServerConfig(): ServerConfig | null {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  useEffect(() => {
    let alive = true;
    getServerConfig()
      .then((c) => alive && setConfig(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'How do I start a chat?',
    a: (
      <>
        Tap the new chat button, then pick a contact or search for someone by their exact{' '}
        <b>@username</b> or phone number (with country code). You can also{' '}
        <Link to="/new" className="font-medium text-brand-ink hover:underline">
          add a contact
        </Link>{' '}
        to save them under a name you choose.
      </>
    ),
  },
  {
    q: 'Who can see my last seen, photo and about?',
    a: (
      <>
        You decide in{' '}
        <Link to="/settings/privacy" className="font-medium text-brand-ink hover:underline">
          Privacy
        </Link>
        : everyone, only your contacts, or nobody. If you hide your last seen, you can’t see other
        people’s either.
      </>
    ),
  },
  {
    q: 'How do I use Enbox on another device?',
    a: 'Open Enbox in a browser on that device and log in with your username and password. Manage every signed-in device from Linked devices.',
  },
  {
    q: 'How do disappearing messages work?',
    a: 'When a timer is on, new messages vanish from the chat after 24 hours, 7 days or 90 days. Turn it on per chat from the contact or group info, or set a default for new chats in Privacy.',
  },
  {
    q: 'What happens when I block someone?',
    a: 'They can’t message or call you, and they no longer see your last seen, online status, photo or about. They aren’t notified.',
  },
  {
    q: 'Can I install Enbox as an app?',
    a: 'Yes. Use “Install app” or “Add to Home Screen” in your browser menu to get Enbox in its own window with notifications.',
  },
];

const SHORTCUTS: [string, string][] = [
  ['Enter', 'Send message (when “Enter is send” is on)'],
  ['Shift + Enter', 'New line'],
  ['Esc', 'Close dialogs, menus and panels'],
  ['↑ / ↓', 'Move through menus'],
  ['Tab', 'Move between controls'],
];

/** Settings → Help: version, FAQ, keyboard shortcuts. */
export function HelpPage() {
  const config = useServerConfig();
  return (
    <SettingsScroller>
      <div className="flex flex-col items-center gap-2 px-6 py-8 text-center lg:py-4">
        <LogoMark size={72} className="drop-shadow-lg" />
        <h2 className="mt-3 text-xl font-semibold text-fg">{APP_NAME} for Web</h2>
        <p className="text-[14px] text-muted" data-testid="app-version">
          Version {config?.version ?? '…'}
        </p>
      </div>

      <SettingsGroup title="Help center">
        {FAQ.map((f) => (
          <details key={f.q} className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 text-[15.5px] text-fg outline-none hover:bg-hover focus-visible:bg-hover lg:px-5 [&::-webkit-details-marker]:hidden">
              <span className="flex-1">{f.q}</span>
              <ChevronDown
                size={18}
                className="shrink-0 text-subtle transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="px-4 pb-4 text-[14px] leading-relaxed text-muted lg:px-5">{f.a}</div>
          </details>
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Keyboard shortcuts"
        footer={
          <span className="inline-flex items-center gap-2">
            <Keyboard size={16} aria-hidden /> Enbox works great with a keyboard.
          </span>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 px-4 py-3 lg:px-5">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded-md border border-line-strong bg-surface-2 px-2 py-0.5 font-sans text-[12.5px] font-medium text-fg">
                  {k}
                </kbd>
              </dt>
              <dd className="text-[14px] text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </SettingsGroup>

      <SettingsNote>
        {APP_NAME} is a messenger for chats, groups, communities, channels, status updates and
        calls. Messages are stored on your {APP_NAME} server and synced to every device you link.
      </SettingsNote>
    </SettingsScroller>
  );
}

/** Settings → Storage and data: local usage, upload limits, clear cached app files. */
export function StoragePage() {
  const config = useServerConfig();
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = () => {
    void navigator.storage
      ?.estimate?.()
      .then((e) => setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => undefined);
  };
  useEffect(refresh, []);

  const clear = async () => {
    const ok = await confirm({
      title: 'Clear cached app files?',
      message:
        'Enbox will download its app files again the next time you open it. Your chats and settings are not affected.',
      confirmLabel: 'Clear',
    });
    if (!ok) return;
    setClearing(true);
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      toast.success('Cache cleared');
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setClearing(false);
    }
  };

  const pct =
    estimate && estimate.quota ? Math.min(100, (estimate.usage / estimate.quota) * 100) : 0;

  return (
    <SettingsScroller>
      <SettingsGroup title="This device">
        <div className="flex flex-col gap-3 px-4 py-4 lg:px-5">
          <div className="flex items-center gap-3">
            <HardDrive size={22} className="text-muted" aria-hidden />
            <div className="flex-1">
              <p className="text-[16px] text-fg">
                {estimate ? `${formatBytes(estimate.usage)} used` : 'Calculating…'}
              </p>
              {estimate?.quota ? (
                <p className="text-[13px] text-muted">
                  of {formatBytes(estimate.quota)} available to Enbox in this browser
                </p>
              ) : null}
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${Math.max(pct, estimate?.usage ? 1 : 0)}%` }}
            />
          </div>
        </div>
        <SettingsRow
          icon={Trash2}
          title="Clear cached app files"
          description="Frees space; your chats stay on the server"
          onClick={() => void clear()}
          end={clearing ? <Spinner size={18} label={null} /> : undefined}
        />
      </SettingsGroup>
      <SettingsGroup title="Network">
        <SettingsRow
          icon={Upload}
          title="Maximum file size"
          description={config ? formatBytes(config.maxUploadBytes) : '…'}
        />
        <SettingsRow
          icon={Database}
          title="Media quality"
          description="Photos are optimized before sending. Send as a document to keep the original."
        />
      </SettingsGroup>
    </SettingsScroller>
  );
}
