/**
 * Code blocks with a language: highlight.js loads on first use (the core, then the language),
 * plain text until then, React elements from its output (never HTML); ```ansi blocks and
 * unknown or missing tags stay as they are.
 */
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { RichText } from '../RichText';
import { codeLanguage, highlightNow, loadLanguage, tokensOf } from './highlight';

describe('codeLanguage', () => {
  it('maps the tags people write to the languages we load', () => {
    expect(codeLanguage('ts')).toBe('typescript');
    expect(codeLanguage('TSX')).toBe('typescript');
    expect(codeLanguage('py')).toBe('python');
    expect(codeLanguage('sh')).toBe('bash');
    expect(codeLanguage('html')).toBe('xml');
    expect(codeLanguage('c++')).toBe('cpp');
    expect(codeLanguage('c#')).toBe('csharp');
    expect(codeLanguage('toml')).toBe('ini');
    expect(codeLanguage('rust')).toBe('rust');
  });

  it('nothing for plain text, unknown tags or none', () => {
    expect(codeLanguage(null)).toBeNull();
    expect(codeLanguage('txt')).toBeNull();
    expect(codeLanguage('ansi')).toBeNull();
    expect(codeLanguage('brainfork')).toBeNull();
    expect(codeLanguage('constructor')).toBeNull();
  });
});

describe('tokensOf', () => {
  it('reads spans and decodes the escaped text', () => {
    expect(
      tokensOf('<span class="hljs-keyword">if</span> (a &lt; b &amp;&amp; c) <span class="hljs-string">&quot;x&#x27;s&quot;</span>'),
    ).toEqual([
      { cls: 'hljs-keyword', children: ['if'] },
      ' (a < b && c) ',
      { cls: 'hljs-string', children: ['"x\'s"'] },
    ]);
  });

  it('nests scopes', () => {
    expect(tokensOf('<span class="hljs-a"><span class="hljs-b">x</span>y</span>z')).toEqual([
      { cls: 'hljs-a', children: [{ cls: 'hljs-b', children: ['x'] }, 'y'] },
      'z',
    ]);
  });
});

describe('highlighted code blocks', () => {
  it('render plain text first, then highlighted once the language loads', async () => {
    const code = 'const a = 1; // <b>not markup</b>';
    const { container } = render(<RichText text={`\`\`\`ts\n${code}\n\`\`\``} />);
    const el = () => container.querySelector('pre[data-lang="ts"] code')!;
    expect(el().textContent).toBe(code);
    await waitFor(() => expect(el()).toHaveAttribute('data-language', 'typescript'));
    expect(el().textContent).toBe(code);
    expect(el().querySelector('.hljs-keyword')).toHaveTextContent('const');
    expect(el().querySelector('b')).toBeNull();
  });

  it('once loaded, highlight at once (rows the list re-mounts)', async () => {
    await loadLanguage('python');
    expect(highlightNow('def f(): pass', 'python')).toEqual(
      expect.arrayContaining([expect.objectContaining({ cls: 'hljs-keyword' })]),
    );
    const { container } = render(<RichText text={'```py\nreturn 1\n```'} />);
    expect(container.querySelector('code')).toHaveAttribute('data-language', 'python');
  });

  it('leaves blocks without a known language plain', () => {
    const { container } = render(<RichText text={'```\nconst a = 1;\n```'} />);
    const code = container.querySelector('pre code')!;
    expect(code.textContent).toBe('const a = 1;');
    expect(code.querySelector('span')).toBeNull();
  });
});
