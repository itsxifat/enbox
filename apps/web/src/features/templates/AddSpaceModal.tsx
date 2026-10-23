/**
 * Add a Space (Discord's "Create Your Server"): (1) Create My Own or a starter template;
 * (2) "Tell us more" — for a club or community, or for me and my friends (cosmetic, it can be
 * skipped); (3) Customize: an icon (uploaded at once, as in Space Settings ▸ Overview) and a
 * name (default "<my name>’s Space"); Create opens the new Space's first text channel. The
 * first step ends with "Have an invite already?" → Join a Space.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Gamepad2,
  GraduationCap,
  Heart,
  House,
  Palette,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import {
  SPACE_NAME_MAX_LENGTH,
  STARTER_TEMPLATES,
  type MediaAttachment,
  type StarterTemplateId,
} from '@enbox/shared';
import { Button, Field, Input, Modal, toast } from '@/components/ui';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { createSpaceAndPath } from './actions';

const STARTER_ICONS: Record<StarterTemplateId, LucideIcon> = {
  gaming: Gamepad2,
  'school-club': GraduationCap,
  'study-group': BookOpen,
  friends: Heart,
  artists: Palette,
  'local-community': House,
};

type Step = 'start' | 'about' | 'customize';

function Choice({
  icon: Icon,
  title,
  sub,
  onClick,
  big,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  sub?: string;
  onClick: () => void;
  big?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl bg-surface-2 px-3 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand',
        big ? 'py-3.5' : 'py-2.5',
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink',
          big ? 'size-12' : 'size-10',
        )}
        aria-hidden
      >
        <Icon size={big ? 24 : 20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-fg">{title}</span>
        {sub ? <span className="block truncate text-[13px] text-muted">{sub}</span> : null}
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
    </button>
  );
}

export function AddSpaceModal({ onClose, onJoin }: { onClose: () => void; onJoin: () => void }) {
  const me = useMe();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('start');
  const [template, setTemplate] = useState<StarterTemplateId | null>(null);
  const defaultName = `${me?.displayName ?? 'My'}’s Space`.slice(0, SPACE_NAME_MAX_LENGTH);
  const [name, setName] = useState(defaultName);
  const [icon, setIcon] = useState<MediaAttachment | null>(null);
  const [busy, setBusy] = useState(false);

  const start = (id: StarterTemplateId | null) => {
    setTemplate(id);
    setStep('about');
  };

  const create = async () => {
    const n = name.trim() || defaultName;
    setBusy(true);
    try {
      const path = await createSpaceAndPath({
        name: n.slice(0, SPACE_NAME_MAX_LENGTH),
        ...(icon ? { iconMediaId: icon.id } : {}),
        ...(template ? { template } : {}),
      });
      onClose();
      navigate(path);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const back = (to: Step) => (
    <Button variant="ghost" leftIcon={ArrowLeft} onClick={() => setStep(to)} className="mr-auto">
      Back
    </Button>
  );

  if (step === 'start')
    return (
      <Modal
        open
        onClose={onClose}
        title="Create Your Space"
        description="Your Space is where you and your friends hang out. Make yours and start talking."
        footer={
          <div className="flex w-full flex-col items-center gap-2">
            <p className="text-[15px] font-semibold text-fg">Have an invite already?</p>
            <Button variant="secondary" fullWidth onClick={onJoin} data-testid="add-space-join">
              Join a Space
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          <Choice
            icon={Sparkles}
            title="Create My Own"
            onClick={() => start(null)}
            big
            testId="add-space-own"
          />
          <p className="section-label mt-3 mb-1">Start from a template</p>
          {STARTER_TEMPLATES.map((s) => (
            <Choice
              key={s.id}
              icon={STARTER_ICONS[s.id]}
              title={s.name}
              sub={s.description}
              onClick={() => start(s.id)}
              testId={`add-space-starter-${s.id}`}
            />
          ))}
        </div>
      </Modal>
    );

  if (step === 'about')
    return (
      <Modal
        open
        onClose={onClose}
        title="Tell us more about your Space"
        description="To help with your setup: is your new Space for just a few friends or a larger community?"
        footer={back('start')}
      >
        <div className="flex flex-col gap-2">
          <Choice
            icon={UsersRound}
            title="For a club or community"
            onClick={() => setStep('customize')}
            big
          />
          <Choice
            icon={Heart}
            title="For me and my friends"
            onClick={() => setStep('customize')}
            big
          />
          <button
            type="button"
            onClick={() => setStep('customize')}
            className="mt-2 self-center text-[14px] text-muted hover:text-fg"
          >
            Not sure? You can{' '}
            <span className="font-semibold text-brand-ink">skip this question</span> for now.
          </button>
        </div>
      </Modal>
    );

  return (
    <Modal
      open
      onClose={onClose}
      title="Customize your Space"
      description="Give your new Space a personality with a name and an icon. You can always change it later."
      footer={
        <>
          {back('about')}
          <Button
            loading={busy}
            disabled={!name.trim()}
            onClick={() => void create()}
            data-testid="create-space-submit"
          >
            Create
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        className="flex flex-col items-center gap-5"
      >
        <div className="flex flex-col items-center gap-1.5">
          <EditableAvatar
            src={icon ? (icon.animated ? (icon.thumbnailUrl ?? icon.url) : icon.url) : null}
            animatedSrc={icon?.animated ? icon.url : null}
            name={name.trim() || defaultName}
            kind="community"
            size={88}
            label="Upload a Space icon"
            onUploaded={(m) => setIcon(m)}
            onRemove={icon ? () => setIcon(null) : undefined}
          />
          <span className="text-[12px] text-muted">{icon ? 'Looks great' : 'Upload an icon'}</span>
        </div>
        <Field label="Space name" htmlFor="space-name" className="w-full">
          <Input
            id="space-name"
            value={name}
            maxLength={SPACE_NAME_MAX_LENGTH}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            data-testid="create-space-name"
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
