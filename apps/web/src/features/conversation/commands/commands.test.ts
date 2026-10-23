import { describe, expect, it } from 'vitest';
import { makeChat } from '@/test/factories';
import { inlineToPlain, parseRichText } from '../lib/richText';
import {
  SHRUG,
  SLASH_COMMANDS,
  TABLEFLIP,
  UNFLIP,
  applyCommand,
  commandQuery,
  matchCommands,
} from './commands';

/** What a message renders as (markdown applied, formatting dropped). */
const rendered = (text: string) => inlineToPlain(parseRichText(text), (id) => id);

const group = makeChat({ id: 'g1', type: 'group' });
const space = { spaceId: 's1', categoryId: null, position: 0, overwrites: [] } as never;
const channel = makeChat({ id: 'c1', type: 'space_text', name: 'general', space });
const voice = makeChat({ id: 'v1', type: 'space_voice', name: 'Lounge', space });

describe('slash commands', () => {
  it('the list shows while a command name is typed at the very start', () => {
    expect(commandQuery('/')).toBe('');
    expect(commandQuery('/Sh')).toBe('sh');
    expect(commandQuery('/shrug ')).toBeNull();
    expect(commandQuery(' /shrug')).toBeNull();
    expect(commandQuery('hi /shrug')).toBeNull();
    expect(matchCommands('').map((c) => c.name)).toEqual(SLASH_COMMANDS.map((c) => c.name));
    expect(matchCommands('s').map((c) => c.name)).toEqual(['shrug', 'spoiler']);
    expect(matchCommands('t').map((c) => c.name)).toEqual(['tableflip', 'tts', 'thread']);
    expect(matchCommands('zzz')).toEqual([]);
  });

  it('each chat lists what it offers: /nick in Spaces, /thread in text channels', () => {
    expect(matchCommands('', group).map((c) => c.name)).toEqual([
      'shrug',
      'tableflip',
      'unflip',
      'me',
      'spoiler',
      'tts',
    ]);
    expect(matchCommands('', channel).map((c) => c.name)).toEqual([
      'shrug',
      'tableflip',
      'unflip',
      'me',
      'spoiler',
      'tts',
      'nick',
      'thread',
    ]);
    expect(matchCommands('t', voice).map((c) => c.name)).toEqual(['tableflip', 'tts']);
    // Every command explains itself in the list.
    for (const c of SLASH_COMMANDS) expect(c.description, c.name).toMatch(/\.$/);
  });

  it('applies the built-in commands on send', () => {
    expect(applyCommand('/shrug')).toEqual({ text: SHRUG });
    expect(applyCommand('/shrug  oh well ')).toEqual({ text: `oh well ${SHRUG}` });
    expect(applyCommand('/tableflip enough')).toEqual({ text: `enough ${TABLEFLIP}` });
    expect(applyCommand('/unflip')).toEqual({ text: UNFLIP });
    expect(applyCommand('/me waves hello')).toEqual({ text: '_waves hello_' });
    expect(applyCommand('/spoiler the butler did it')).toEqual({ text: '||the butler did it||' });
    expect(applyCommand('/SHRUG')).toEqual({ text: SHRUG });
    // Multi-line messages keep their lines.
    expect(applyCommand('/spoiler line one\nline two')).toEqual({ text: '||line one\nline two||' });
  });

  it('/tts sends the message as is, read aloud', () => {
    expect(applyCommand('/tts hello there', group)).toEqual({ text: 'hello there', tts: true });
    expect(applyCommand('/TTS **loud**', channel)).toEqual({ text: '**loud**', tts: true });
    expect(applyCommand('/tts', group)).toEqual({
      missing: expect.objectContaining({ name: 'tts' }),
    });
  });

  it('/nick and /thread run instead of sending, where the chat offers them', () => {
    const nick = applyCommand('/nick  Captain ', channel);
    expect(nick).toEqual({ run: expect.any(Function) });
    expect(applyCommand('/nick', channel)).toEqual({ run: expect.any(Function) });
    expect(applyCommand('/thread Plans', channel)).toEqual({ run: expect.any(Function) });
    expect(applyCommand('/thread', channel)).toEqual({
      missing: expect.objectContaining({ name: 'thread' }),
    });
    // Elsewhere they are plain text.
    expect(applyCommand('/nick Captain', group)).toBeNull();
    expect(applyCommand('/thread Plans', voice)).toBeNull();
  });

  it('a required message must be there; anything else is sent as typed', () => {
    expect(applyCommand('/me')).toEqual({ missing: expect.objectContaining({ name: 'me' }) });
    expect(applyCommand('/spoiler   ')).toEqual({
      missing: expect.objectContaining({ name: 'spoiler' }),
    });
    expect(applyCommand('/unknown thing')).toBeNull();
    expect(applyCommand('hello /shrug')).toBeNull();
    expect(applyCommand('just text')).toBeNull();
  });

  it('the faces render as typed (escaped for the markdown)', () => {
    expect(rendered(SHRUG)).toBe('¯\\_(ツ)_/¯');
    expect(rendered(`fine ${SHRUG}`)).toBe('fine ¯\\_(ツ)_/¯');
    expect(rendered(TABLEFLIP)).toBe('(╯°□°)╯︵ ┻━┻');
    expect(rendered(`my_var ${UNFLIP}`)).toBe('my_var ┬─┬ノ( º _ ºノ)');
    // /me is italic, /spoiler a spoiler.
    expect(parseRichText('_waves_')).toEqual([
      { t: 'italic', children: [{ t: 'text', text: 'waves' }] },
    ]);
    expect(parseRichText('||secret||')).toEqual([
      { t: 'spoiler', children: [{ t: 'text', text: 'secret' }] },
    ]);
  });
});
