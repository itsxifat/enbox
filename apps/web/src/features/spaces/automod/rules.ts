/**
 * AutoMod editor helpers (Space Settings → AutoMod, features/spaces/settings/AutoModPage.tsx):
 * the four rule cards, a rule's editable draft and the request body made from it. The server
 * (modules/automod) checks the same limits.
 */
import type {
  AutoModAction,
  AutoModPreset,
  AutoModRule,
  AutoModTriggerType,
  CreateAutoModRuleRequest,
  ID,
  UpdateAutoModRuleRequest,
} from '@enbox/shared';

/** Timeout lengths offered by a rule (Discord's chips) and by an alert's "Timeout member". */
export const AUTOMOD_TIMEOUTS = [
  { seconds: 60, label: '60 secs', long: '60 seconds' },
  { seconds: 300, label: '5 mins', long: '5 minutes' },
  { seconds: 600, label: '10 mins', long: '10 minutes' },
  { seconds: 3600, label: '1 hour', long: '1 hour' },
  { seconds: 86400, label: '1 day', long: '1 day' },
  { seconds: 604800, label: '1 week', long: '1 week' },
] as const;

/** The schema limits of `triggerMetadata` and actions (packages/shared community.ts). */
export const AUTOMOD_LIMITS = {
  keywords: 1000,
  keywordLength: 60,
  patterns: 10,
  patternLength: 260,
  allowList: 100,
  customMessage: 150,
  mentionLimit: 50,
} as const;

export const DEFAULT_MENTION_LIMIT = 20;

export const AUTOMOD_PRESET_OPTIONS: readonly { id: AutoModPreset; label: string; description: string }[] = [
  { id: 'profanity', label: 'Profanity', description: 'Swearing and insults' },
  { id: 'sexual', label: 'Sexual content', description: 'Words and phrases about sexual acts' },
  { id: 'slurs', label: 'Slurs', description: 'Hateful words aimed at groups of people' },
];

/** The cards of the page, in Discord's order (keyword rules are the "custom words" card). */
export const AUTOMOD_CARDS: readonly { type: AutoModTriggerType; title: string; description: string; name: string }[] = [
  {
    type: 'mention_spam',
    title: 'Block Mention Spam',
    description: 'Block messages that mention too many members and roles at once.',
    name: 'Mention Spam',
  },
  {
    type: 'spam_links',
    title: 'Block Suspected Spam Content',
    description: 'Block links from members who just joined, and the same link posted over and over.',
    name: 'Suspected Spam',
  },
  {
    type: 'preset',
    title: 'Block Commonly Flagged Words',
    description: 'Block messages with words from ready-made lists.',
    name: 'Commonly Flagged Words',
  },
  {
    type: 'keyword',
    title: 'Block Custom Words',
    description: 'Block messages with words, phrases or patterns you choose.',
    name: 'Custom Words',
  },
];

export function cardOf(type: AutoModTriggerType) {
  return AUTOMOD_CARDS.find((c) => c.type === type)!;
}

/** Words of a textarea: separated by commas or new lines, trimmed, without blanks or repeats. */
export function parseWords(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
}

/** One entry per line (patterns may contain commas). */
export function parseLines(text: string): string[] {
  return [...new Set(text.split('\n').map((s) => s.trim()).filter(Boolean))];
}

export interface RuleDraft {
  name: string;
  enabled: boolean;
  /** Textarea contents. */
  keywords: string;
  patterns: string;
  allowList: string;
  mentionLimit: number;
  presets: AutoModPreset[];
  block: boolean;
  customMessage: string;
  alert: boolean;
  alertChannelId: ID | null;
  timeout: boolean;
  timeoutSeconds: number;
  exemptRoleIds: ID[];
  exemptChannelIds: ID[];
}

/** The draft of a rule, or of a new one (Discord's defaults: block on). */
export function draftOf(type: AutoModTriggerType, rule?: AutoModRule | null, name?: string): RuleDraft {
  const md = rule?.triggerMetadata ?? {};
  const actions = rule?.actions ?? [{ type: 'block' as const }];
  const block = actions.find((a) => a.type === 'block');
  const alert = actions.find((a) => a.type === 'alert');
  const timeout = actions.find((a) => a.type === 'timeout');
  return {
    name: rule?.name ?? name ?? cardOf(type).name,
    enabled: rule?.enabled ?? true,
    keywords: (md.keywords ?? []).join(', '),
    patterns: (md.regexPatterns ?? []).join('\n'),
    allowList: (md.allowList ?? []).join(', '),
    mentionLimit: md.mentionLimit ?? DEFAULT_MENTION_LIMIT,
    presets: md.presets ?? (rule ? [] : ['profanity', 'sexual', 'slurs']),
    block: !!block,
    customMessage: block?.type === 'block' ? (block.customMessage ?? '') : '',
    alert: !!alert,
    alertChannelId: alert?.type === 'alert' ? alert.channelId : null,
    timeout: !!timeout,
    timeoutSeconds: timeout?.type === 'timeout' ? timeout.durationSeconds : 60,
    exemptRoleIds: rule?.exemptRoleIds ?? [],
    exemptChannelIds: rule?.exemptChannelIds ?? [],
  };
}

/** The create body of a draft (a PATCH sends it without `triggerType`), or what is wrong. */
export function bodyOf(
  type: AutoModTriggerType,
  d: RuleDraft,
): { body: CreateAutoModRuleRequest; error: null } | { body: null; error: string } {
  const fail = (error: string) => ({ body: null, error });
  const name = d.name.trim();
  if (!name) return fail('Give the rule a name');
  const actions: AutoModAction[] = [];
  if (d.block) actions.push({ type: 'block', customMessage: d.customMessage.trim() || null });
  if (d.alert) {
    if (!d.alertChannelId) return fail('Choose the channel that gets the alerts');
    actions.push({ type: 'alert', channelId: d.alertChannelId });
  }
  if (d.timeout) actions.push({ type: 'timeout', durationSeconds: d.timeoutSeconds });
  if (actions.length === 0) return fail('Choose at least one response');
  let triggerMetadata: CreateAutoModRuleRequest['triggerMetadata'] = {};
  const allowList = parseWords(d.allowList);
  if (allowList.length > AUTOMOD_LIMITS.allowList) return fail(`Allow up to ${AUTOMOD_LIMITS.allowList} words`);
  if (allowList.some((w) => w.length > AUTOMOD_LIMITS.keywordLength))
    return fail(`Allowed words can be up to ${AUTOMOD_LIMITS.keywordLength} characters`);
  if (type === 'keyword') {
    const keywords = parseWords(d.keywords);
    const regexPatterns = parseLines(d.patterns);
    if (keywords.length === 0 && regexPatterns.length === 0) return fail('Add at least one word or pattern');
    if (keywords.length > AUTOMOD_LIMITS.keywords) return fail(`Use up to ${AUTOMOD_LIMITS.keywords} words`);
    const long = keywords.find((w) => w.length > AUTOMOD_LIMITS.keywordLength);
    if (long) return fail(`“${long.slice(0, 20)}…” is longer than ${AUTOMOD_LIMITS.keywordLength} characters`);
    if (regexPatterns.length > AUTOMOD_LIMITS.patterns) return fail(`Use up to ${AUTOMOD_LIMITS.patterns} patterns`);
    if (regexPatterns.some((p) => p.length > AUTOMOD_LIMITS.patternLength))
      return fail(`Patterns can be up to ${AUTOMOD_LIMITS.patternLength} characters`);
    triggerMetadata = { keywords, regexPatterns, allowList };
  } else if (type === 'preset') {
    if (d.presets.length === 0) return fail('Choose at least one list');
    triggerMetadata = { presets: d.presets, allowList };
  } else if (type === 'mention_spam') {
    const limit = Math.round(d.mentionLimit);
    if (!(limit >= 1 && limit <= AUTOMOD_LIMITS.mentionLimit))
      return fail(`The mention limit is between 1 and ${AUTOMOD_LIMITS.mentionLimit}`);
    triggerMetadata = { mentionLimit: limit };
  }
  return {
    body: {
      name,
      triggerType: type,
      triggerMetadata,
      actions,
      enabled: d.enabled,
      exemptRoleIds: d.exemptRoleIds,
      exemptChannelIds: d.exemptChannelIds,
    },
    error: null,
  };
}

/** The PATCH of an edited rule: everything but the trigger type (which never changes). */
export function patchOf(body: CreateAutoModRuleRequest): UpdateAutoModRuleRequest {
  return {
    name: body.name,
    triggerMetadata: body.triggerMetadata,
    actions: body.actions,
    enabled: body.enabled,
    exemptRoleIds: body.exemptRoleIds,
    exemptChannelIds: body.exemptChannelIds,
  };
}
