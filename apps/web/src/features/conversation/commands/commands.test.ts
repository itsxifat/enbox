import { describe, expect, it } from 'vitest';
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

describe('slash commands', () => {
  it('the list shows while a command name is typed at the very start', () => {
    expect(commandQuery('/')).toBe('');
    expect(commandQuery('/Sh')).toBe('sh');
    expect(commandQuery('/shrug ')).toBeNull();
    expect(commandQuery(' /shrug')).toBeNull();
    expect(commandQuery('hi /shrug')).toBeNull();
    expect(matchCommands('').map((c) => c.name)).toEqual(SLASH_COMMANDS.map((c) => c.name));
    expect(matchCommands('s').map((c) => c.name)).toEqual(['shrug', 'spoiler']);
    expect(matchCommands('t').map((c) => c.name)).toEqual(['tableflip']);
    expect(matchCommands('zzz')).toEqual([]);
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
