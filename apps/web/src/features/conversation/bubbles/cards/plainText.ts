/**
 * Message text as plain words — message link cards and text-to-speech: the markdown
 * (lib/richText.ts) without its formatting, mentions as names, custom emoji as `:name:`,
 * timestamps as dates, spoilers left out, lines joined. Pure.
 */
import type { ID } from '@enbox/shared';
import {
  formatTimestamp,
  inlineToPlain,
  parseMarkdown,
  type Block,
  type Inline,
} from '../../lib/richText';

function simplify(segments: Inline[], spoiler: string): Inline[] {
  return segments.map((s): Inline => {
    switch (s.t) {
      case 'spoiler':
        return { t: 'text', text: spoiler };
      case 'timestamp':
        return { t: 'text', text: formatTimestamp(s.unix, s.style) };
      case 'link':
        return s.children ? { ...s, children: simplify(s.children, spoiler) } : s;
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strike':
        return { ...s, children: simplify(s.children, spoiler) };
      default:
        return s;
    }
  });
}

function flatten(blocks: Block[], out: Inline[]): Inline[] {
  for (const b of blocks) {
    if (b.b === 'quote') flatten(b.children, out);
    else if (b.b === 'list') for (const item of b.items) flatten(item, out);
    else {
      if (b.b === 'code') out.push({ t: 'text', text: b.code });
      else out.push(...b.children);
      out.push({ t: 'text', text: ' ' });
    }
  }
  return out;
}

/** `text` read as plain words; `spoiler` stands in for each spoiler. */
export function plainMessageText(
  text: string,
  nameOf: (id: ID) => string,
  opts: { spoiler?: string } = {},
): string {
  const segments = simplify(flatten(parseMarkdown(text), []), opts.spoiler ?? 'spoiler');
  return inlineToPlain(segments, nameOf).replace(/\s+/g, ' ').trim();
}
