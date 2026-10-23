/**
 * Built-in slash commands (Discord's): `/` at the start of the composer lists the ones the
 * chat offers, picking one fills `/name `, and sending applies it. A command rewrites the
 * message (`apply`), adds send options to it (`send`: /tts), or does something instead of
 * sending one (`run`: /nick, /thread — commands/actions.ts).
 *
 *   /shrug [message]      message ¯\_(ツ)_/¯
 *   /tableflip [message]  message (╯°□°)╯︵ ┻━┻
 *   /unflip [message]     message ┬─┬ノ( º _ ºノ)
 *   /me <message>         _message_ (italic)
 *   /spoiler <message>    ||message||
 *   /tts <message>        sent with `tts: true`: read aloud to whoever is viewing the chat
 *                         with text-to-speech on (anyone may: there is no SEND_TTS bit)
 *   /nick [name]          my nickname in this Space (empty resets it); Space channels only
 *   /thread <name>        a new thread of this text channel, opened beside it
 *
 * The faces are escaped for the markdown (bubbles/RichText) so they render as typed.
 */
import type { ChatSummary } from '@enbox/shared';
import { setNickname, startThread } from './actions';

export interface SlashCommand {
  name: string;
  description: string;
  /** The text after the command ("message"); a required one can't be left out. */
  option: string;
  required: boolean;
  /** Whether the chat offers it (default: every chat). */
  available?(chat: ChatSummary): boolean;
  /** The message to send for `arg` (trimmed, may be empty when optional); default: `arg`. */
  apply?(arg: string): string;
  /** Options the message is sent with. */
  send?: { tts?: boolean };
  /** Done instead of sending a message. */
  run?(arg: string, chat: ChatSummary): Promise<void>;
}

/** `¯\_(ツ)_/¯` with the backslash and underscores escaped. */
export const SHRUG = '¯\\\\\\_(ツ)\\_/¯';
export const TABLEFLIP = '(╯°□°)╯︵ ┻━┻';
export const UNFLIP = '┬─┬ノ( º \\_ ºノ)';

const append = (face: string) => (arg: string) => (arg ? `${arg} ${face}` : face);
const inSpace = (chat: ChatSummary) => !!chat.space;

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
  {
    name: 'tts',
    description: 'Reads your message aloud to everyone viewing this chat.',
    option: 'message',
    required: true,
    send: { tts: true },
  },
  {
    name: 'nick',
    description: 'Changes your nickname in this Space.',
    option: 'name',
    required: false,
    available: inSpace,
    run: (arg, chat) => setNickname(chat, arg),
  },
  {
    name: 'thread',
    description: 'Starts a thread in this channel.',
    option: 'name',
    required: true,
    available: (chat) => chat.type === 'space_text',
    run: (arg, chat) => startThread(chat, arg),
  },
];

/** The command name being typed: `/` and letters at the very start, nothing after them yet. */
export function commandQuery(text: string): string | null {
  const m = /^\/([\w-]*)$/.exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

const offered = (c: SlashCommand, chat: ChatSummary | undefined) =>
  !chat || !c.available || c.available(chat);

/** Commands whose name starts with `query`, in list order (those `chat` offers, when given). */
export function matchCommands(query: string, chat?: ChatSummary): SlashCommand[] {
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(query) && offered(c, chat));
}

export function findCommand(name: string, chat?: ChatSummary): SlashCommand | undefined {
  return SLASH_COMMANDS.find((c) => c.name === name.toLowerCase() && offered(c, chat));
}

export type AppliedCommand =
  { text: string; tts?: boolean } | { missing: SlashCommand } | { run: () => Promise<void> };

/**
 * What sending `text` does: the message to send (`{ text, tts? }`), `{ missing }` when the
 * command needs a message and has none, `{ run }` for a command that sends nothing, or null
 * when `text` isn't a command `chat` offers (sent as typed).
 */
export function applyCommand(text: string, chat?: ChatSummary): AppliedCommand | null {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const command = m ? findCommand(m[1]!, chat) : undefined;
  if (!m || !command) return null;
  const arg = (m[2] ?? '').trim();
  if (!arg && command.required) return { missing: command };
  if (command.run) {
    const run = command.run;
    return chat ? { run: () => run(arg, chat) } : null;
  }
  const out: { text: string; tts?: boolean } = { text: command.apply ? command.apply(arg) : arg };
  if (command.send?.tts) out.tts = true;
  return out;
}
