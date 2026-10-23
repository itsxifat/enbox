/**
 * Built-in slash commands (Discord's): `/` at the start of the composer lists them, picking
 * one fills `/name `, and sending applies it to the message. Pure (unit-tested).
 *
 *   /shrug [message]      message ¯\_(ツ)_/¯
 *   /tableflip [message]  message (╯°□°)╯︵ ┻━┻
 *   /unflip [message]     message ┬─┬ノ( º _ ºノ)
 *   /me <message>         _message_ (italic)
 *   /spoiler <message>    ||message||
 *
 * The faces are escaped for the markdown (bubbles/RichText) so they render as typed.
 */

export interface SlashCommand {
  name: string;
  description: string;
  /** The text after the command ("message"); a required one can't be left out. */
  option: string;
  required: boolean;
  /** The message to send for `arg` (trimmed, may be empty when optional). */
  apply(arg: string): string;
}

/** `¯\_(ツ)_/¯` with the backslash and underscores escaped. */
export const SHRUG = '¯\\\\\\_(ツ)\\_/¯';
export const TABLEFLIP = '(╯°□°)╯︵ ┻━┻';
export const UNFLIP = '┬─┬ノ( º \\_ ºノ)';

const append = (face: string) => (arg: string) => (arg ? `${arg} ${face}` : face);

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: 'shrug',
    description: 'Appends ¯\\_(ツ)_/¯ to your message.',
    option: 'message',
    required: false,
    apply: append(SHRUG),
  },
  {
    name: 'tableflip',
    description: 'Appends (╯°□°)╯︵ ┻━┻ to your message.',
    option: 'message',
    required: false,
    apply: append(TABLEFLIP),
  },
  {
    name: 'unflip',
    description: 'Appends ┬─┬ノ( º _ ºノ) to your message.',
    option: 'message',
    required: false,
    apply: append(UNFLIP),
  },
  {
    name: 'me',
    description: 'Displays text with emphasis.',
    option: 'message',
    required: true,
    apply: (arg) => `_${arg}_`,
  },
  {
    name: 'spoiler',
    description: 'Marks your message as a spoiler.',
    option: 'message',
    required: true,
    apply: (arg) => `||${arg}||`,
  },
];

/** The command name being typed: `/` and letters at the very start, nothing after them yet. */
export function commandQuery(text: string): string | null {
  const m = /^\/([\w-]*)$/.exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

/** Commands whose name starts with `query`, in list order. */
export function matchCommands(query: string): SlashCommand[] {
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(query));
}

export function findCommand(name: string): SlashCommand | undefined {
  return SLASH_COMMANDS.find((c) => c.name === name.toLowerCase());
}

export type AppliedCommand = { text: string } | { missing: SlashCommand };

/**
 * The message `text` sends: its command applied (`{ text }`), `{ missing }` when the command
 * needs a message and has none, or null when `text` isn't a command (sent as typed).
 */
export function applyCommand(text: string): AppliedCommand | null {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const command = m ? findCommand(m[1]!) : undefined;
  if (!m || !command) return null;
  const arg = (m[2] ?? '').trim();
  if (!arg && command.required) return { missing: command };
  return { text: command.apply(arg) };
}
