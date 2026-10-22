import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ImageUp, Trash2 } from 'lucide-react';
import {
  BANNER_MIME_TYPES,
  SPACE_DESCRIPTION_MAX_LENGTH,
  SPACE_NAME_MAX_LENGTH,
  SPACE_SYSTEM_FLAGS,
  type ID,
  type Space,
  type UpdateSpaceRequest,
} from '@enbox/shared';
import { Button, Field, Input, RadioGroup, Switch, Textarea, toast } from '@/components/ui';
import { EditableAvatar } from '@/features/groups/shared/EditableAvatar';
import { BannerCropDialog } from '@/features/settings/profile/BannerCropDialog';
import { useMe } from '@/stores/auth';
import { useSpaceChannels, useSpaces } from '@/stores/spaces';
import { updateSpace } from '../actions';
import { DeleteSpaceDialog } from './DeleteSpaceDialog';

/** Inactive Timeout choices (the server accepts exactly these). */
const AFK_TIMEOUTS = [
  { sec: 60, label: '1 minute' },
  { sec: 300, label: '5 minutes' },
  { sec: 900, label: '15 minutes' },
  { sec: 1800, label: '30 minutes' },
  { sec: 3600, label: '1 hour' },
] as const;

interface Draft {
  name: string;
  description: string;
  afkChannelId: ID | null;
  afkTimeoutSec: number;
  systemChannelId: ID | null;
  systemFlags: number;
  defaultNotifyLevel: 'all' | 'mentions';
  rulesChannelId: ID | null;
  isDiscoverable: boolean;
}

function draftOf(s: Space): Draft {
  return {
    name: s.name,
    description: s.description ?? '',
    afkChannelId: s.afkChannelId,
    afkTimeoutSec: s.afkTimeoutSec,
    systemChannelId: s.systemChannelId,
    systemFlags: s.systemFlags,
    defaultNotifyLevel: s.defaultNotifyLevel,
    rulesChannelId: s.rulesChannelId,
    isDiscoverable: s.isDiscoverable,
  };
}

/** The PATCH body for what changed (empty when nothing did). */
export function overviewChanges(space: Space, d: Draft): UpdateSpaceRequest {
  const out: UpdateSpaceRequest = {};
  if (d.name.trim() !== space.name) out.name = d.name.trim();
  if ((d.description.trim() || null) !== space.description) out.description = d.description.trim() || null;
  if (d.afkChannelId !== space.afkChannelId) out.afkChannelId = d.afkChannelId;
  if (d.afkTimeoutSec !== space.afkTimeoutSec) out.afkTimeoutSec = d.afkTimeoutSec as 300;
  if (d.systemChannelId !== space.systemChannelId) out.systemChannelId = d.systemChannelId;
  if (d.systemFlags !== space.systemFlags) out.systemFlags = d.systemFlags;
  if (d.defaultNotifyLevel !== space.defaultNotifyLevel) out.defaultNotifyLevel = d.defaultNotifyLevel;
  if (d.rulesChannelId !== space.rulesChannelId) out.rulesChannelId = d.rulesChannelId;
  if (d.isDiscoverable !== space.isDiscoverable) out.isDiscoverable = d.isDiscoverable;
  return out;
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-bold tracking-wide text-muted uppercase">{title}</h3>
      {description ? <p className="-mt-1 text-[13px] text-muted">{description}</p> : null}
      {children}
    </section>
  );
}

function ChannelSelect({
  id,
  value,
  onChange,
  options,
  none,
}: {
  id: string;
  value: ID | null;
  onChange: (id: ID | null) => void;
  options: { id: ID; name: string }[];
  none: string;
}) {
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className="h-11 w-full rounded-xl bg-surface-2 px-3">
      <option value="">{none}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/** Space Settings → Overview (Discord's server overview), MANAGE_SPACE. */
export function OverviewPage({ space }: { space: Space }) {
  const me = useMe();
  const channels = useSpaceChannels(space.id);
  const loaded = useSpaces((s) => !!s.channelsLoaded[space.id]);
  const [draft, setDraft] = useState<Draft>(() => draftOf(space));
  const [busy, setBusy] = useState(false);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [deleting, setDeleting] = useState(false);
  const bannerInput = useRef<HTMLInputElement>(null);
  const changes = useMemo(() => overviewChanges(space, draft), [space, draft]);
  const dirty = Object.keys(changes).length > 0;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    if (!loaded)
      void useSpaces
        .getState()
        .loadSpace(space.id)
        .catch(() => undefined);
  }, [loaded, space.id]);

  const text = channels.filter((c) => c.type === 'space_text').map((c) => ({ id: c.id, name: `#${c.name}` }));
  const voice = channels.filter((c) => c.type === 'space_voice').map((c) => ({ id: c.id, name: c.name ?? 'Voice' }));
  const flagOn = (flag: number) => (draft.systemFlags & flag) === 0;
  const setFlag = (flag: number, on: boolean) => set('systemFlags', on ? draft.systemFlags & ~flag : draft.systemFlags | flag);

  const save = async () => {
    if (!dirty || !draft.name.trim()) return;
    setBusy(true);
    try {
      const fresh = await updateSpace(space.id, changes);
      setDraft(draftOf(fresh));
      toast.success('Changes saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const media = (body: UpdateSpaceRequest, done: string) =>
    updateSpace(space.id, body).then(
      () => void toast.success(done),
      (e: unknown) => void toast.error(e),
    );

  return (
    <div className="flex flex-col gap-8 pb-24">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="flex flex-col items-center gap-2">
          <EditableAvatar
            src={space.iconUrl}
            animatedSrc={space.iconAnimatedUrl}
            name={space.name}
            colorSeed={space.id}
            kind="community"
            size={100}
            label="Change Space icon"
            onUploaded={(m) => media({ iconMediaId: m.id }, 'Icon updated')}
            onRemove={space.iconUrl ? () => media({ iconMediaId: null }, 'Icon removed') : undefined}
          />
          <span className="text-[12px] text-muted">Minimum 128×128</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Field label="Space name" htmlFor="sp-name">
            <Input id="sp-name" value={draft.name} maxLength={SPACE_NAME_MAX_LENGTH} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="sp-desc" hint="Shown on invites and in Space discovery.">
            <Textarea id="sp-desc" rows={3} value={draft.description} maxLength={SPACE_DESCRIPTION_MAX_LENGTH} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
      </div>

      <Section title="Banner" description="Shown at the top of the channel list.">
        <div className="aspect-[5/2] w-full max-w-md overflow-hidden rounded-xl bg-surface-2">
          {space.bannerUrl ? <img src={space.bannerUrl} alt="" className="size-full object-cover" /> : null}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="soft" leftIcon={ImageUp} onClick={() => bannerInput.current?.click()}>
            {space.bannerUrl ? 'Change Banner' : 'Upload Banner'}
          </Button>
          {space.bannerUrl ? (
            <Button size="sm" variant="ghost" leftIcon={Trash2} onClick={() => void media({ bannerMediaId: null }, 'Banner removed')}>
              Remove
            </Button>
          ) : null}
        </div>
        <input
          ref={bannerInput}
          type="file"
          accept={[...BANNER_MIME_TYPES].join(',')}
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setBannerFile(f);
          }}
        />
        <BannerCropDialog
          file={bannerFile}
          onClose={() => setBannerFile(null)}
          onUploaded={async (m) => {
            await updateSpace(space.id, { bannerMediaId: m.id });
          }}
        />
      </Section>

      <Section title="Inactive channel" description="Voice members who stay idle longer than the timeout are moved here and muted.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Inactive Channel" htmlFor="sp-afk">
            <ChannelSelect id="sp-afk" value={draft.afkChannelId} onChange={(v) => set('afkChannelId', v)} options={voice} none="No Inactive Channel" />
          </Field>
          <Field label="Inactive Timeout" htmlFor="sp-afk-timeout">
            <select id="sp-afk-timeout" value={draft.afkTimeoutSec} onChange={(e) => set('afkTimeoutSec', Number(e.target.value))} className="h-11 w-full rounded-xl bg-surface-2 px-3">
              {AFK_TIMEOUTS.map((t) => (
                <option key={t.sec} value={t.sec}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="System messages" description="The channel where Enbox posts system messages, such as when someone joins.">
        <Field label="System Messages Channel" htmlFor="sp-system">
          <ChannelSelect id="sp-system" value={draft.systemChannelId} onChange={(v) => set('systemChannelId', v)} options={text} none="No System Messages" />
        </Field>
        <div className="card-inset flex flex-col px-3">
          <Switch
            checked={flagOn(SPACE_SYSTEM_FLAGS.SUPPRESS_JOIN_NOTIFICATIONS)}
            onChange={(v) => setFlag(SPACE_SYSTEM_FLAGS.SUPPRESS_JOIN_NOTIFICATIONS, v)}
            disabled={!draft.systemChannelId}
            label="Send a random welcome message when someone joins this Space."
          />
          <Switch
            checked={flagOn(SPACE_SYSTEM_FLAGS.SUPPRESS_JOIN_REPLIES)}
            onChange={(v) => setFlag(SPACE_SYSTEM_FLAGS.SUPPRESS_JOIN_REPLIES, v)}
            disabled={!draft.systemChannelId}
            label="Prompt members to reply to welcome messages with a sticker."
            description="Saved now; the sticker reply button arrives with stickers."
          />
          <Switch
            checked={flagOn(SPACE_SYSTEM_FLAGS.SUPPRESS_SETUP_TIPS)}
            onChange={(v) => setFlag(SPACE_SYSTEM_FLAGS.SUPPRESS_SETUP_TIPS, v)}
            disabled={!draft.systemChannelId}
            label="Send helpful tips for Space setup."
            description="Saved now; Enbox does not post setup tips yet."
          />
        </div>
      </Section>

      <Section
        title="Default notification settings"
        description="Members get this unless they change it for themselves. Big Spaces should use Only @mentions."
      >
        <RadioGroup
          name="sp-default-notify"
          aria-label="Default notification settings"
          value={draft.defaultNotifyLevel}
          onChange={(v) => set('defaultNotifyLevel', v)}
          options={[
            { value: 'all', label: 'All Messages' },
            { value: 'mentions', label: 'Only @mentions' },
          ]}
        />
      </Section>

      <Section title="Rules channel" description="Where members find the rules and guidelines of this Space.">
        <Field label="Rules or Guidelines Channel" htmlFor="sp-rules">
          <ChannelSelect id="sp-rules" value={draft.rulesChannelId} onChange={(v) => set('rulesChannelId', v)} options={text} none="No Rules Channel" />
        </Field>
      </Section>

      <Section title="Discovery">
        <div className="card-inset flex flex-col px-3">
          <Switch checked={draft.isDiscoverable} onChange={(v) => set('isDiscoverable', v)} label="Listed in Space discovery" description="People can find and preview it." />
        </div>
      </Section>

      {space.ownerId === me?.id ? (
        <Section title="Delete Space" description="Deletes every channel and message for everyone. This cannot be undone.">
          <div>
            <Button variant="danger" leftIcon={Trash2} onClick={() => setDeleting(true)}>
              Delete Space
            </Button>
          </div>
        </Section>
      ) : null}
      {deleting ? <DeleteSpaceDialog space={space} onClose={() => setDeleting(false)} /> : null}

      {dirty ? (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-4 z-10 flex items-center gap-3 rounded-2xl bg-elevated p-3 pl-4 shadow-elevated"
        >
          <span className="min-w-0 flex-1 text-[14px] font-medium">Careful — you have unsaved changes!</span>
          <Button variant="ghost" size="sm" onClick={() => setDraft(draftOf(space))}>
            Reset
          </Button>
          <Button size="sm" loading={busy} disabled={!draft.name.trim()} onClick={() => void save()}>
            Save Changes
          </Button>
        </div>
      ) : null}
    </div>
  );
}
