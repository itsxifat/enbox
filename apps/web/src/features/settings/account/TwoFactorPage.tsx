import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Copy, KeyRound, ListChecks, ScanLine, ShieldCheck, Smartphone } from 'lucide-react';
import { totpCodeSchema, type TotpSetup } from '@enbox/shared';
import { Button, IconButton, Input, toast, type IconType } from '@/components/ui';
import { copyText } from '@/features/groups/shared/share';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { SettingsGroup, SettingsHero, SettingsScroller } from '../ui';
import { BackupCodesList } from './BackupCodesList';
import { QrCode } from './QrCode';
import { TwoFactorRows } from './TwoFactorRows';
import { enableTotp, formatSecret, setupTotp } from './twoFactorApi';

const STEPS = [
  'Download an authenticator app',
  'Scan the QR code',
  'Enter the 6-digit code',
  'Save your backup codes',
] as const;
type Step = 1 | 2 | 3 | 4;

/**
 * My Account ▸ Two-factor authentication. Off: the setup wizard (download an app → scan the
 * QR code or type the key → confirm a code → save the backup codes). On: the status, backup
 * codes and removal (the same rows as My Account). Which one shows is decided when the page
 * opens, so turning it on mid-wizard (here, or `me:updated`) never swaps the backup codes step
 * away.
 */
export function TwoFactorPage() {
  const me = useMe();
  const [mode, setMode] = useState<'wizard' | 'manage'>(() =>
    me?.mfaEnabled ? 'manage' : 'wizard',
  );
  if (!me) return null;
  if (mode === 'wizard') return <SetupWizard />;
  return (
    <SettingsScroller>
      <SettingsHero
        icon={ShieldCheck}
        title={
          me.mfaEnabled ? 'Two-factor authentication is on' : 'Two-factor authentication is off'
        }
      >
        {me.mfaEnabled
          ? 'Logging in asks for your password and a code from your authenticator app, or one of your backup codes.'
          : 'Add a second step to logging in: a code from an authenticator app on your phone.'}
      </SettingsHero>
      <SettingsGroup>
        <TwoFactorRows onEnable={() => setMode('wizard')} />
      </SettingsGroup>
    </SettingsScroller>
  );
}

function SetupWizard() {
  const navigate = useNavigate();
  const me = useMe();
  const [step, setStep] = useState<Step>(1);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [loading, setLoading] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  /** Step 2 needs a secret: asked for once, kept while going back and forth. */
  const toScan = async () => {
    if (setup) {
      setStep(2);
      return;
    }
    setLoading(true);
    try {
      setSetup(await setupTotp());
      setStep(2);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  /** The secret was replaced or confirmed elsewhere: scan a new one. */
  const restart = () => {
    setSetup(null);
    setStep(1);
  };

  const finish = () => {
    toast.success('Two-factor authentication is on', {
      description: 'Logging in now asks for a code from your authenticator app.',
    });
    void navigate('/settings/account', { replace: true });
  };

  return (
    <SettingsScroller>
      <StepProgress step={step} />
      {step === 1 ? (
        <StepCard icon={Smartphone} title={STEPS[0]}>
          <p>
            Download and install an authenticator app on your phone or tablet. Any app that makes
            time-based codes (TOTP) works, and so do most password managers.
          </p>
          <StepActions>
            <Button onClick={() => void toScan()} loading={loading}>
              Next
            </Button>
          </StepActions>
        </StepCard>
      ) : step === 2 && setup ? (
        <StepCard icon={ScanLine} title={STEPS[1]}>
          <ScanStep setup={setup} />
          <StepActions>
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={() => setStep(3)}>Next</Button>
          </StepActions>
        </StepCard>
      ) : step === 3 ? (
        <StepCard icon={KeyRound} title={STEPS[2]}>
          <CodeStep
            onBack={() => setStep(2)}
            onRestart={restart}
            onEnabled={(fresh) => {
              setCodes(fresh);
              setStep(4);
            }}
          />
        </StepCard>
      ) : codes ? (
        <StepCard icon={ListChecks} title={STEPS[3]}>
          <p>
            Each code logs you in once if you lose your phone or can't use your authenticator app.
            Keep them somewhere safe, like a password manager: they won't be shown again.
          </p>
          <BackupCodesList codes={codes} username={me?.username ?? ''} onDone={finish} />
        </StepCard>
      ) : null}
    </SettingsScroller>
  );
}

/** "Step 2 of 4" over four bars, the done ones in the brand colour. */
function StepProgress({ step }: { step: Step }) {
  return (
    <div className="flex flex-col gap-2 px-2">
      <p className="section-label">
        Step {step} of {STEPS.length}
      </p>
      <ol className="grid grid-cols-4 gap-1.5" aria-label="Setup steps">
        {STEPS.map((title, i) => (
          <li
            key={title}
            aria-current={i + 1 === step ? 'step' : undefined}
            className={cn('h-1.5 rounded-full', i + 1 <= step ? 'bg-brand' : 'bg-line-strong')}
          >
            <span className="sr-only">{title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepCard({
  icon: Icon,
  title,
  children,
}: {
  icon: IconType;
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="card-inset flex flex-col gap-4 p-5 text-[15px] leading-relaxed text-muted lg:p-6"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <Icon size={22} aria-hidden />
        </span>
        <h2 id={id} className="text-[17px] leading-snug font-semibold text-fg">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function StepActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 pt-1">{children}</div>;
}

/** The QR code to scan, or the key to type in (groups of 4, copyable). */
function ScanStep({ setup }: { setup: TotpSetup }) {
  const copyKey = async () => {
    if (await copyText(setup.secret)) toast.success('Key copied');
    else toast.error("Couldn't copy. Select the key and copy it manually.");
  };
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <div className="shrink-0 overflow-hidden rounded-xl bg-white shadow-sm">
        <QrCode value={setup.otpauthUrl} label="QR code for your authenticator app" size={176} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4 self-stretch">
        <p>Open your authenticator app and scan this QR code with your phone's camera.</p>
        <div className="flex flex-col gap-1.5">
          <p className="section-label">Or enter this key manually</p>
          <div className="flex items-center gap-2 rounded-xl bg-surface py-1.5 pr-1.5 pl-3.5">
            <code
              className="min-w-0 flex-1 font-mono text-[14px] tracking-wide break-all text-fg select-all"
              aria-label="Setup key"
            >
              {formatSecret(setup.secret)}
            </code>
            <IconButton icon={Copy} label="Copy key" size="sm" onClick={() => void copyKey()} />
          </div>
        </div>
        {/* On a phone the app is usually on the same device: open it directly. */}
        <a
          href={setup.otpauthUrl}
          className="self-start rounded text-[14px] font-semibold text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand lg:hidden"
        >
          Open in your authenticator app
        </a>
      </div>
    </div>
  );
}

/** The first code from the app confirms the secret; sent as soon as 6 digits are in. */
function CodeStep({
  onBack,
  onRestart,
  onEnabled,
}: {
  onBack: () => void;
  onRestart: () => void;
  onEnabled: (codes: string[]) => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sending = useRef(false);

  useEffect(() => {
    if (!error) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [error]);

  const send = async (value: string) => {
    if (sending.current) return;
    const parsed = totpCodeSchema.safeParse(value);
    if (!parsed.success) {
      setError('Enter the 6-digit code');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      onEnabled(await enableTotp(parsed.data));
    } catch (err) {
      sending.current = false;
      setBusy(false);
      if (err instanceof ApiError && err.code === 'invalid_code')
        setError(err.message || 'Invalid two-factor code');
      // The secret was replaced (a setup on another device) or it is on already.
      else if (err instanceof ApiError && err.code === 'conflict') setStale(err.message);
      else setError(errorMessage(err));
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(code);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="Confirm code">
      <p>Enter the 6-digit code your authenticator app shows for Enbox.</p>
      <Input
        ref={inputRef}
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        autoFocus
        placeholder="000000"
        className="font-mono text-[18px] tracking-[0.3em]"
        containerClassName="max-w-60"
        value={code}
        disabled={busy}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          setError(null);
          if (digits.length === 6) void send(digits);
        }}
        error={error ?? undefined}
      />
      {stale ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger"
        >
          {stale}
          <Button variant="secondary" size="sm" className="self-start" onClick={onRestart}>
            Start over
          </Button>
        </div>
      ) : null}
      <StepActions>
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button type="submit" loading={busy}>
          Activate
        </Button>
      </StepActions>
    </form>
  );
}
