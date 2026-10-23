/** ```ansi code blocks: Discord's colour codes styled, the codes hidden, the text never markup. */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { RichText } from './RichText';

const E = '\u001b';

describe('RichText ```ansi blocks', () => {
  it('styles the text, hides the codes and keeps markup as text', () => {
    const { container } = render(
      <RichText
        text={`\`\`\`ansi\n${E}[1;31mAlert${E}[0m ${E}[4;45m<b>boxed</b>${E}[0m\n\`\`\``}
      />,
    );
    const code = container.querySelector('pre[data-lang="ansi"] code')!;
    expect(code.textContent).toBe('Alert <b>boxed</b>');
    expect(code.querySelector('b')).toBeNull();
    const [alert, , boxed] = Array.from(code.querySelectorAll('span'));
    expect(alert).toHaveClass('font-bold');
    expect(boxed).toHaveClass('underline');
    expect(boxed).toHaveStyle({ backgroundColor: '#6c71c4', color: '#fdf6e3' });
  });

  it('leaves other code blocks as they are', () => {
    const { container } = render(<RichText text={'```js\nconst a = 1;\n```'} />);
    const code = container.querySelector('pre[data-lang="js"] code')!;
    expect(code.textContent).toBe('const a = 1;');
    expect(code.querySelector('span')).toBeNull();
  });
});
