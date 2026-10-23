/**
 * Space Settings → AutoMod (MANAGE_SPACE; also linked from Safety Setup), Discord's page: one
 * card per kind — Block Mention Spam, Block Suspected Spam Content, Block Commonly Flagged
 * Words — and Block Custom Words with any number of keyword rules (MAX_AUTOMOD_RULES in all).
 * A card's switch turns its rule on and off; "Set up" / "Edit" opens the editor: the trigger
 * (mention limit, word lists, words with `*` wildcards and an n/1000 counter, patterns, allowed
 * words), the response (block with an optional custom message, an alert to a channel, a
 * timeout from 60 secs to 1 week), exempt roles and channels, Save / Delete. The list stays
 * live through `automod:rules` (sent to the managers' devices). Drafts and bodies: ../automod/rules.ts.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { AtSign, Check, Link2, MessageSquareWarning, Plus, ShieldAlert, TextCursorInput } from 'lucide-react';
import {
  MAX_AUTOMOD_RULES,
  type AutoModRule,
  type AutoModTriggerType,
  type ChatSummary,
  type ID,
  type Space,
} from '@enbox/shared';
import { Button, Checkbox, Input, Spinner, Switch, Textarea, confirm, toast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { getSocket } from '@/lib/socket';
import { useSpaceChannels, useSpaces } from '@/stores/spaces';
import {
  AUTOMOD_LIMITS,
  AUTOMOD_PRESET_OPTIONS,
  AUTOMOD_TIMEOUTS,
  bodyOf,
  cardOf,
  draftOf,
  parseLines,
  parseWords,
  patchOf,
  type RuleDraft,
} from '../automod/rules';

const rulesPath = (spaceId: ID) => `/api/spaces/${spaceId}/automod/rules`;

const ICONS: Record<AutoModTriggerType, typeof AtSign> = {
  mention_spam: AtSign,
  spam_links: Link2,
  preset: MessageSquareWarning,
  keyword: TextCursorInput,
};

const SINGLE_TYPES = ['mention_spam', 'spam_links', 'preset'] as const;

/** What a saved rule does, in a line. */
function summaryOf(rule: AutoModRule, channels: ChatSummary[]): string {
  const md = rule.triggerMetadata;
  const what =
    rule.triggerType === 'mention_spam'
      ? `More than ${md.mentionLimit ?? 20} mentions`
      : rule.triggerType === 'preset'
        ? AUTOMOD_PRESET_OPTIONS.filter((p) => md.presets?.includes(p.id))
            .map((p) => p.label)
            .join(', ')
        : rule.triggerType === 'keyword'
          ? [
              `${md.keywords?.length ?? 0} word${md.keywords?.length === 1 ? '' : 's'}`,
              md.regexPatterns?.length ? `${md.regexPatterns.length} pattern${md.regexPatterns.length === 1 ? '' : 's'}` : null,
            ]
              .filter(Boolean)
              .join(', ')
          : 'Links from new members, repeated links';
  const does = rule.actions.map((a) =>
    a.type === 'block'
      ? 'blocks'
      : a.type === 'alert'
        ? `alerts #${channels.find((c) => c.id === a.channelId)?.name ?? 'channel'}`
        : `times out ${AUTOMOD_TIMEOUTS.find((t) => t.seconds === a.durationSeconds)?.label ?? `${a.durationSeconds}s`}`,
  );
  return `${what} · ${does.join(', ')}`;
}

export function AutoModPage({ space }: { space: Space }) {
  const [rules, setRules] = useState<AutoModRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The open editor: a rule id, a single kind not set up yet, or 'new-keyword'. */
  const [open, setOpen] = useState<string | null>(null);
  const channels = useSpaceChannels(space.id);
  const loaded = useSpaces((s) => !!s.channelsLoaded[space.id]);

  useEffect(() => {
    if (!loaded)
      void useSpaces
        .getState()
        .loadSpace(space.id)
        .catch(() => undefined);
  }, [loaded, space.id]);

  useEffect(() => {
    let live = true;
    setRules(null);
    setError(null);
    api
      .get<AutoModRule[]>(rulesPath(space.id))
      .then((list) => live && setRules(list))
      .catch((e: unknown) => live && setError(errorMessage(e, 'Couldn’t load the rules')));
    const socket = getSocket();
    const onRules = (p: { spaceId: ID; rules: AutoModRule[] }) => {
      if (p.spaceId === space.id) setRules(p.rules);
    };
    socket?.on('automod:rules', onRules);
    return () => {
      live = false;
      socket?.off('automod:rules', onRules);
    };
  }, [space.id]);

  const saved = (rule: AutoModRule) =>
    setRules((list) => {
      const l = list ?? [];
      return l.some((r) => r.id === rule.id) ? l.map((r) => (r.id === rule.id ? rule : r)) : [...l, rule];
    });
  const deleted = (id: ID) => setRules((list) => (list ?? []).filter((r) => r.id !== id));

  const keywordRules = (rules ?? []).filter((r) => r.triggerType === 'keyword');
  const full = (rules?.length ?? 0) >= MAX_AUTOMOD_RULES;
  const common = { space, channels, onSaved: saved, onDeleted: deleted };

  return (
    <div className="flex flex-col gap-4" data-testid="automod-page">
      <p className="text-[14px] text-muted">
        AutoMod checks messages in this Space’s channels before anyone sees them, and acts on its own. The owner and members
        with Manage Space or Administrator are never affected.
      </p>
      {error ? <p className="text-danger">{error}</p> : null}
      {!rules && !error ? <Spinner /> : null}
      {rules ? (
        <>
          {SINGLE_TYPES.map((type) => {
            const rule = rules.find((r) => r.triggerType === type) ?? null;
            const key = rule?.id ?? type;
            return (
              <RuleCard
                key={type}
                {...common}
                type={type}
                rule={rule}
                title={cardOf(type).title}
                open={open === key}
                onOpen={(o) => setOpen(o ? key : null)}
              />
            );
          })}
          <section className="card-inset flex flex-col gap-3 p-4" data-testid="automod-card-keyword">
            <div className="flex items-center gap-3">
              <CardIcon type="keyword" />
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold">{cardOf('keyword').title}</h3>
                <p className="text-[13px] text-muted">{cardOf('keyword').description}</p>
              </div>
              <Button size="sm" leftIcon={Plus} disabled={full || open === 'new-keyword'} onClick={() => setOpen('new-keyword')}>
                Create Keyword Rule
              </Button>
            </div>
            {full ? (
              <p className="text-[13px] text-muted">This Space has the most rules it can have ({MAX_AUTOMOD_RULES}).</p>
            ) : null}
            {keywordRules.map((rule) => (
              <RuleCard
                key={rule.id}
                {...common}
                type="keyword"
                rule={rule}
                title={rule.name}
                nested
                open={open === rule.id}
                onOpen={(o) => setOpen(o ? rule.id : null)}
              />
            ))}
            {open === 'new-keyword' ? (
              <RuleCard
                {...common}
                type="keyword"
                rule={null}
                title="New keyword rule"
                newName={keywordRules.length ? `Custom Words ${keywordRules.length + 1}` : 'Custom Words'}
                nested
                open
                onOpen={(o) => setOpen(o ? 'new-keyword' : null)}
              />
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function CardIcon({ type }: { type: AutoModTriggerType }) {
  const Icon = ICONS[type];
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink" aria-hidden>
      <Icon size={20} />
    </span>
  );
}

interface CardProps {
  space: Space;
  channels: ChatSummary[];
  type: AutoModTriggerType;
  rule: AutoModRule | null;
  title: string;
  /** A keyword rule inside the Custom Words card. */
  nested?: boolean;
  newName?: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  onSaved: (rule: AutoModRule) => void;
  onDeleted: (id: ID) => void;
}

function RuleCard(p: CardProps) {
  const { space, type, rule, title, open } = p;
  const [busy, setBusy] = useState(false);
  const toggle = async (enabled: boolean) => {
    if (!rule) return;
    setBusy(true);
    try {
      p.onSaved(await api.patch<AutoModRule>(`${rulesPath(space.id)}/${rule.id}`, { enabled }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={cn(p.nested ? 'rounded-xl bg-surface' : 'card-inset')}
      data-testid={p.nested ? `automod-rule-${rule?.id ?? 'new'}` : `automod-card-${type}`}
    >
      <div className="flex items-center gap-3 p-4">
        {p.nested ? null : <CardIcon type={type} />}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold">{title}</h3>
          <p className="text-[13px] text-muted">{rule ? summaryOf(rule, p.channels) : cardOf(type).description}</p>
        </div>
        {rule ? (
          <Switch checked={rule.enabled} disabled={busy} onChange={(v) => void toggle(v)} aria-label={`${title} on`} />
        ) : null}
        <Button size="sm" variant={rule || open ? 'ghost' : 'soft'} aria-expanded={open} onClick={() => p.onOpen(!open)}>
          {open ? 'Close' : rule ? 'Edit' : 'Set up'}
        </Button>
      </div>
      {open ? <RuleEditor {...p} onClose={() => p.onOpen(false)} /> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h4 className="section-label">{title}</h4>
      {children}
    </section>
  );
}

/** Toggle chips: a compact multi-select (Discord's exemption pickers). */
function ChipSelect({
  label,
  items,
  selected,
  max,
  empty,
  onChange,
}: {
  label: string;
  items: { id: ID; label: string; color?: string | null }[];
  selected: ID[];
  max: number;
  empty: string;
  onChange: (ids: ID[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-fg">{label}</p>
      {items.length === 0 ? <p className="text-[13px] text-muted">{empty}</p> : null}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {items.map((it) => {
          const on = selected.includes(it.id);
          return (
            <button
              key={it.id}
              type="button"
              aria-pressed={on}
              disabled={!on && selected.length >= max}
              onClick={() => onChange(on ? selected.filter((x) => x !== it.id) : [...selected, it.id])}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] transition-colors disabled:opacity-50',
                on ? 'bg-brand-soft font-medium text-brand-ink' : 'bg-surface-2 text-muted hover:bg-hover hover:text-fg',
              )}
            >
              {on ? <Check size={14} aria-hidden /> : null}
              {it.color !== undefined ? (
                <span className="size-2 rounded-full" style={{ background: it.color ?? 'var(--color-muted)' }} aria-hidden />
              ) : null}
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RuleEditor({
  space,
  channels,
  type,
  rule,
  newName,
  onSaved,
  onDeleted,
  onClose,
}: CardProps & { onClose: () => void }) {
  const [d, setD] = useState<RuleDraft>(() => draftOf(type, rule, newName));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setFormError(null);
  };
  const textChannels = channels.filter((c) => c.type === 'space_text');
  const exemptable = channels.filter((c) => c.type === 'space_text' || c.type === 'space_voice' || c.type === 'space_forum');
  const roles = space.roles.filter((r) => !r.isDefault).sort((a, b) => b.position - a.position);
  const keywordCount = parseWords(d.keywords).length;
  const patternCount = parseLines(d.patterns).length;
  const allowCount = parseWords(d.allowList).length;

  const save = async () => {
    const out = bodyOf(type, d);
    if (out.error !== null) {
      setFormError(out.error);
      return;
    }
    setBusy(true);
    try {
      const result = rule
        ? await api.patch<AutoModRule>(`${rulesPath(space.id)}/${rule.id}`, patchOf(out.body))
        : await api.post<AutoModRule>(rulesPath(space.id), out.body);
      onSaved(result);
      toast.success(rule ? 'Changes saved' : 'Rule created');
      onClose();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!rule) return;
    const ok = await confirm({
      title: 'Delete rule?',
      message: `“${rule.name}” stops checking messages. This can’t be undone.`,
      confirmLabel: 'Delete Rule',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`${rulesPath(space.id)}/${rule.id}`);
      onDeleted(rule.id);
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };

  const allowField = (
    <Textarea
      label="Allowed words"
      aside={`${allowCount}/${AUTOMOD_LIMITS.allowList}`}
      value={d.allowList}
      rows={2}
      placeholder="Separate with commas, e.g. class, assassin"
      hint="Never flagged, even when they match. A * works here too."
      onChange={(e) => set('allowList', e.target.value)}
    />
  );

  return (
    <div className="flex flex-col gap-6 px-4 pb-4" data-testid="automod-editor">
      {type === 'keyword' ? (
        <Input label="Rule name" value={d.name} maxLength={100} onChange={(e) => set('name', e.target.value)} />
      ) : null}

      <Section title="Trigger">
        {type === 'keyword' ? (
          <>
            <Textarea
              label="Words and phrases"
              aside={<span data-testid="automod-keyword-count">{`${keywordCount}/${AUTOMOD_LIMITS.keywords}`}</span>}
              value={d.keywords}
              rows={4}
              placeholder="Separate with commas or new lines, e.g. spoiler, free coins, *crypto*"
              hint="Not case-sensitive, whole words. A * at the start or end matches part of a word: *cat matches bobcat, cat* matches catapult, *cat* matches location."
              onChange={(e) => set('keywords', e.target.value)}
            />
            <Textarea
              label="Regular expressions"
              aside={`${patternCount}/${AUTOMOD_LIMITS.patterns}`}
              value={d.patterns}
              rows={2}
              placeholder="One per line, e.g. b[a@]d\s*w[o0]rd"
              hint="Case-insensitive. Patterns that could run too long (nested repeats, backreferences, lookarounds) are refused."
              className="font-mono text-[14px]"
              onChange={(e) => set('patterns', e.target.value)}
            />
            {allowField}
          </>
        ) : type === 'preset' ? (
          <>
            <div className="flex flex-col gap-1">
              {AUTOMOD_PRESET_OPTIONS.map((o) => (
                <Checkbox
                  key={o.id}
                  checked={d.presets.includes(o.id)}
                  onChange={(on) => set('presets', on ? [...d.presets, o.id] : d.presets.filter((x) => x !== o.id))}
                  label={o.label}
                  description={o.description}
                />
              ))}
            </div>
            {allowField}
          </>
        ) : type === 'mention_spam' ? (
          <Input
            type="number"
            label="Mention limit"
            min={1}
            max={AUTOMOD_LIMITS.mentionLimit}
            value={String(d.mentionLimit)}
            hint="Blocks messages with more unique user and role mentions than this (@everyone and @here count too)."
            onChange={(e) => set('mentionLimit', Number(e.target.value))}
          />
        ) : (
          <p className="text-[13px] text-muted">
            Flags links from members who joined less than 10 minutes ago, and the same link posted more than 3 times within 5
            minutes.
          </p>
        )}
      </Section>

      <Section title="Response">
        <div className="flex flex-col gap-2">
          <Checkbox
            checked={d.block}
            onChange={(v) => set('block', v)}
            label="Block message"
            description="The message is not posted; the member sees why."
          />
          {d.block ? (
            <Input
              aria-label="Custom message"
              placeholder="Custom message (optional)"
              maxLength={AUTOMOD_LIMITS.customMessage}
              value={d.customMessage}
              hint="Shown to the member whose message was blocked."
              containerClassName="pl-8"
              onChange={(e) => set('customMessage', e.target.value)}
            />
          ) : null}
          <Checkbox
            checked={d.alert}
            onChange={(v) => set('alert', v)}
            label="Send an alert"
            description="Posts the message and the rule in a channel of your choice."
          />
          {d.alert ? (
            <div className="pl-8">
              <select
                aria-label="Alert channel"
                value={d.alertChannelId ?? ''}
                onChange={(e) => set('alertChannelId', e.target.value || null)}
                className="h-11 w-full rounded-xl bg-surface-2 px-3"
              >
                <option value="">Choose a channel</option>
                {textChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Checkbox
            checked={d.timeout}
            onChange={(v) => set('timeout', v)}
            label="Timeout member"
            description="The member can still read, but can’t talk for a while."
          />
          {d.timeout ? (
            <div className="flex flex-wrap gap-1.5 pl-8" role="radiogroup" aria-label="Timeout duration">
              {AUTOMOD_TIMEOUTS.map((t) => (
                <button
                  key={t.seconds}
                  type="button"
                  role="radio"
                  aria-checked={d.timeoutSeconds === t.seconds}
                  onClick={() => set('timeoutSeconds', t.seconds)}
                  className={cn(
                    'rounded-full px-3 py-1 text-[13px] font-medium uppercase transition-colors',
                    d.timeoutSeconds === t.seconds ? 'bg-brand text-on-brand' : 'bg-surface-2 text-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Exemptions">
        <ChipSelect
          label="Exempt roles"
          items={roles.map((r) => ({ id: r.id, label: r.name, color: r.color }))}
          selected={d.exemptRoleIds}
          max={20}
          empty="This Space has no roles yet."
          onChange={(ids) => set('exemptRoleIds', ids)}
        />
        <ChipSelect
          label="Exempt channels"
          items={exemptable.map((c) => ({ id: c.id, label: c.type === 'space_text' ? `#${c.name}` : (c.name ?? 'Channel') }))}
          selected={d.exemptChannelIds}
          max={50}
          empty="No channels loaded yet."
          onChange={(ids) => set('exemptChannelIds', ids)}
        />
      </Section>

      {formError ? (
        <p role="alert" className="flex items-center gap-2 text-[13px] text-danger">
          <ShieldAlert size={16} aria-hidden />
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {rule ? (
          <Button variant="ghost" className="text-danger" onClick={() => void remove()}>
            Delete Rule
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={busy} onClick={() => void save()}>
          {rule ? 'Save Changes' : 'Create Rule'}
        </Button>
      </div>
    </div>
  );
}
