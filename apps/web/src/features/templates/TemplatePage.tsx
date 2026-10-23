/**
 * Space Settings ▸ Space Template (MANAGE_SPACE): share this Space's structure as a link.
 * Without a template: what is copied and what isn't, then a title and description and
 * "Generate Template". With one: its link (Copy), "Sync Template" while the Space has changed
 * since the last sync, title and description edits, Preview and Delete, and what it builds.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy, Eye, RefreshCw, Trash2, X } from 'lucide-react';
import type { Space, SpaceTemplate } from '@enbox/shared';
import { Button, Field, Input, Spinner, Textarea, confirm, toast } from '@/components/ui';
import { copyText } from '@/features/groups/shared/share';
import { errorMessage } from '@/lib/api';
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  syncTemplate,
  templateLink,
  updateTemplate,
} from './actions';
import { TemplateStructure } from './TemplateStructure';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 120;

function Copied({ items, good }: { items: string[]; good: boolean }) {
  const Icon = good ? Check : X;
  return (
    <ul className="flex flex-col gap-1.5 text-[14px]">
      {items.map((i) => (
        <li key={i} className="flex items-center gap-2">
          <Icon size={16} className={good ? 'text-success' : 'text-danger'} aria-hidden />
          {i}
        </li>
      ))}
    </ul>
  );
}

export function TemplatePage({ space }: { space: Space }) {
  const [template, setTemplate] = useState<SpaceTemplate | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<'save' | 'sync' | 'delete' | null>(null);

  const show = (t: SpaceTemplate | null) => {
    setTemplate(t);
    setName(t?.name ?? '');
    setDescription(t?.description ?? '');
  };
  const load = useCallback(() => {
    listTemplates(space.id)
      .then((list) => show(list[0] ?? null))
      .catch((e: unknown) => setError(errorMessage(e, 'Could not load the template')));
  }, [space.id]);
  useEffect(() => load(), [load]);

  const run = async (what: 'save' | 'sync' | 'delete', fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="text-danger">{error}</p>;
  if (template === undefined) return <Spinner />;

  const form = (
    <div className="flex flex-col gap-4">
      <Field label="Template Title" htmlFor="tpl-name">
        <Input
          id="tpl-name"
          value={name}
          maxLength={NAME_MAX}
          placeholder="Who is this template for?"
          onChange={(e) => setName(e.target.value)}
          data-testid="template-name"
        />
      </Field>
      <Field
        label="Template Description"
        htmlFor="tpl-desc"
        aside={`${description.length}/${DESCRIPTION_MAX}`}
      >
        <Textarea
          id="tpl-desc"
          rows={2}
          value={description}
          maxLength={DESCRIPTION_MAX}
          placeholder="What can people do in this Space?"
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
    </div>
  );

  if (!template)
    return (
      <div className="flex flex-col gap-6" data-testid="template-page">
        <p className="text-[14px] text-muted">
          Templates are an easy way to share your Space setup: anyone with the link can create a new
          Space with the same channels, roles and permissions as yours.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="card-inset p-4">
            <h3 className="section-label mb-3">What will be copied</h3>
            <Copied
              good
              items={[
                'Channels and channel topics',
                'Roles and permissions',
                'System and inactive channels',
              ]}
            />
          </section>
          <section className="card-inset p-4">
            <h3 className="section-label mb-3">What will not be copied</h3>
            <Copied
              good={false}
              items={['Messages or any content', 'Members', 'Your Space icon, emoji and stickers']}
            />
          </section>
        </div>
        {form}
        <div>
          <Button
            loading={busy === 'save'}
            disabled={!name.trim()}
            onClick={() =>
              void run('save', async () => {
                show(
                  await createTemplate(space.id, {
                    name: name.trim(),
                    description: description.trim() || null,
                  }),
                );
                toast.success('Template created');
              })
            }
            data-testid="template-generate"
          >
            Generate Template
          </Button>
        </div>
      </div>
    );

  const link = templateLink(template.code);
  const edited =
    name.trim() !== template.name || (description.trim() || null) !== template.description;
  return (
    <div className="flex flex-col gap-6" data-testid="template-page">
      <Field label="Template Link" htmlFor="tpl-link">
        <div className="flex gap-2">
          <Input
            id="tpl-link"
            value={link}
            readOnly
            className="font-mono text-[14px]"
            containerClassName="min-w-0 flex-1"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            leftIcon={Copy}
            onClick={() =>
              void copyText(link).then((ok) =>
                ok ? toast.success('Template link copied') : toast.error('Could not copy'),
              )
            }
            data-testid="template-copy"
          >
            Copy
          </Button>
        </div>
      </Field>
      <div className="card-inset flex flex-wrap items-center gap-3 p-3 text-[14px]" role="status">
        <span className="min-w-0 flex-1 text-muted">
          {template.isDirty
            ? 'This template has unsynced changes: the Space changed since it was last synced.'
            : `In sync with ${space.name}. Used ${template.usageCount} ${template.usageCount === 1 ? 'time' : 'times'}.`}
        </span>
        <Button
          size="sm"
          variant="soft"
          leftIcon={RefreshCw}
          disabled={!template.isDirty}
          loading={busy === 'sync'}
          onClick={() =>
            void run('sync', async () => {
              show(await syncTemplate(space.id, template.code));
              toast.success('Template synced');
            })
          }
          data-testid="template-sync"
        >
          Sync Template
        </Button>
      </div>
      {form}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          loading={busy === 'save'}
          disabled={!edited || !name.trim()}
          onClick={() =>
            void run('save', async () => {
              show(
                await updateTemplate(space.id, template.code, {
                  name: name.trim(),
                  description: description.trim() || null,
                }),
              );
              toast.success('Template saved');
            })
          }
        >
          Save Changes
        </Button>
        <Link
          to={`/template/${template.code}`}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-[14px] font-semibold text-fg hover:bg-hover"
        >
          <Eye size={16} aria-hidden />
          Preview Template
        </Link>
        <Button
          variant="ghost"
          leftIcon={Trash2}
          className="ml-auto text-danger"
          loading={busy === 'delete'}
          onClick={() =>
            void run('delete', async () => {
              const ok = await confirm({
                title: 'Delete Template?',
                message: 'Its link stops working. Spaces already created from it stay as they are.',
                confirmLabel: 'Delete Template',
                danger: true,
              });
              if (!ok) return;
              await deleteTemplate(space.id, template.code);
              show(null);
              toast.success('Template deleted');
            })
          }
          data-testid="template-delete"
        >
          Delete Template
        </Button>
      </div>
      <section className="flex flex-col gap-2">
        <h3 className="section-label">What it builds</h3>
        <TemplateStructure snapshot={template.snapshot} />
      </section>
    </div>
  );
}
