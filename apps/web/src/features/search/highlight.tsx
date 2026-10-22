/**
 * Search hits highlighted in result cards: every word of the query, case-insensitively.
 *
 * RichText highlights one needle (`splitHighlight`), so where the browser has the CSS Custom
 * Highlight API the cards register Ranges over their rendered text instead — every word, no
 * DOM changes under React (`::highlight(enbox-search)`, see <SearchHighlightStyle/>). Without
 * the API, RichText's own <mark> highlights the longest word.
 */
import { useLayoutEffect, type RefObject } from 'react';

export const HIGHLIGHT_NAME = 'enbox-search';

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}
type HighlightCtor = new (...ranges: Range[]) => unknown;

function api(): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  const registry = (globalThis.CSS as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Highlight = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  return registry && typeof Highlight === 'function' ? { registry, Highlight } : null;
}

export function supportsHighlights(): boolean {
  return api() !== null;
}

/** Every occurrence of `words` in the text under `root` (longest word first where they overlap). */
export function wordRanges(root: Node, words: readonly string[]): Range[] {
  const needles = [...new Set(words.map((w) => w.toLowerCase()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const out: Range[] = [];
  if (!needles.length) return out;
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').toLowerCase();
    let i = 0;
    while (i < text.length) {
      let at = -1;
      let len = 0;
      for (const n of needles) {
        const j = text.indexOf(n, i);
        if (j !== -1 && (at === -1 || j < at || (j === at && n.length > len))) {
          at = j;
          len = n.length;
        }
      }
      if (at === -1) break;
      const range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + len);
      out.push(range);
      i = at + len;
    }
  }
  return out;
}

/** Ranges of the mounted cards, one shared Highlight (registered while any card has ranges). */
const active = new Map<symbol, Range[]>();

function sync(): void {
  const hl = api();
  if (!hl) return;
  const all = [...active.values()].flat();
  if (all.length) hl.registry.set(HIGHLIGHT_NAME, new hl.Highlight(...all));
  else hl.registry.delete(HIGHLIGHT_NAME);
}

/**
 * Highlight `words` inside `ref` while mounted (no-op without the API). Mentions and names
 * resolve after the first render, so the ranges follow DOM changes inside the card.
 */
export function useWordHighlights(ref: RefObject<HTMLElement | null>, words: readonly string[]): void {
  const key = words.join('\u0000');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !key || !supportsHighlights()) return;
    const id = Symbol('search-card');
    const list = key.split('\u0000');
    const update = () => {
      active.set(id, wordRanges(el, list));
      sync();
    };
    update();
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(update) : null;
    observer?.observe(el, { subtree: true, childList: true, characterData: true });
    return () => {
      observer?.disconnect();
      active.delete(id);
      sync();
    };
  }, [ref, key]);
}

/** The highlight's look (the same tint as RichText's search <mark>). */
export function SearchHighlightStyle() {
  return (
    <style href="enbox-search-highlight" precedence="default">
      {`::highlight(${HIGHLIGHT_NAME}){background-color:color-mix(in srgb,var(--warning) 35%,transparent);color:inherit}`}
    </style>
  );
}
