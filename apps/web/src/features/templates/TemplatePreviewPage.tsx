/**
 * /template/:code: a template's name, description and usage, what it builds (channels and
 * roles), and "Create Space" from it — an icon and a name (default: the template's name).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { LayoutTemplate, Link2Off, RefreshCw } from 'lucide-react';
import { SPACE_NAME_MAX_LENGTH, type MediaAttachment, type SpaceTemplate } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, EmptyState, Field, Input, PageSpinner, toast } from '@/components/ui';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { ApiError, errorMessage } from '@/lib/api';
import { createSpaceAndPath, getTemplate } from './actions';
import { TemplateStructure } from './TemplateStructure';

type State =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'error'; message: string }
  | { status: 'ready'; template: SpaceTemplate };

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-3xl bg-surface p-6 shadow-elevated sm:p-8">{children}</div>;
}

export function TemplatePreviewPage() {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<MediaAttachment | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    getTemplate(code)
      .then((template) => {
        if (!live) return;
        setState({ status: 'ready', template });
        setName(template.name.slice(0, SPACE_NAME_MAX_LENGTH));
      })
      .catch((e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) setState({ status: 'invalid' });
        else setState({ status: 'error', message: errorMessage(e) });
      });
    return () => {
      live = false;
    };
  }, [code, attempt]);

  const create = async (template: SpaceTemplate) => {
    setBusy(true);
    try {
      const path = await createSpaceAndPath({
        name: (name.trim() || template.name).slice(0, SPACE_NAME_MAX_LENGTH),
        template: template.code,
        ...(icon ? { iconMediaId: icon.id } : {}),
      });
      toast.success('Your Space is ready');
      navigate(path, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState({ status: 'invalid' });
      else toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app">
      <PaneHeader title="Space template" back="/spaces" border />
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-8">
        <div className="w-full max-w-2xl">
          {state.status === 'loading' ? (
            <PageSpinner label="Loading template" />
          ) : state.status === 'invalid' ? (
            <Card>
              <EmptyState
                icon={Link2Off}
                title="This template link isn't valid"
                description="It may have been deleted, or the link is mistyped. Ask for a new one."
                action={
                  <Button variant="soft" onClick={() => navigate('/spaces')}>
                    Go to Spaces
                  </Button>
                }
              />
            </Card>
          ) : state.status === 'error' ? (
            <Card>
              <EmptyState
                icon={RefreshCw}
                title="Couldn't open the template"
                description={state.message}
                action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
              />
            </Card>
          ) : (
            <Card>
              <div className="flex flex-col gap-6" data-testid="template-preview">
                <div className="flex items-start gap-4">
                  <span
                    className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink"
                    aria-hidden
                  >
                    <LayoutTemplate size={28} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="section-label">Space template</p>
                    <h1 className="truncate text-[22px] leading-tight font-semibold text-fg">
                      {state.template.name}
                    </h1>
                    {state.template.description ? (
                      <p className="mt-1 text-[14.5px] text-muted">{state.template.description}</p>
                    ) : null}
                    <p className="mt-1 text-[13px] text-subtle">
                      Used {state.template.usageCount}{' '}
                      {state.template.usageCount === 1 ? 'time' : 'times'}
                    </p>
                  </div>
                </div>
                <TemplateStructure snapshot={state.template.snapshot} />
                <form
                  className="card-inset flex flex-col gap-4 p-4 sm:flex-row sm:items-end"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void create(state.template);
                  }}
                >
                  <EditableAvatar
                    src={icon ? (icon.animated ? (icon.thumbnailUrl ?? icon.url) : icon.url) : null}
                    animatedSrc={icon?.animated ? icon.url : null}
                    name={name.trim() || state.template.name}
                    kind="community"
                    size={64}
                    label="Upload a Space icon"
                    onUploaded={(m) => setIcon(m)}
                    onRemove={icon ? () => setIcon(null) : undefined}
                    className="self-center"
                  />
                  <Field label="Space name" htmlFor="tpl-space-name" className="min-w-0 flex-1">
                    <Input
                      id="tpl-space-name"
                      value={name}
                      maxLength={SPACE_NAME_MAX_LENGTH}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    loading={busy}
                    disabled={!name.trim()}
                    data-testid="template-create-space"
                  >
                    Create Space
                  </Button>
                </form>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
