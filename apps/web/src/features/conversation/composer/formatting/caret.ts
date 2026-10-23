/**
 * Where text positions of a textarea are drawn, measured on a hidden mirror div that copies
 * the field's box and text styles so its text wraps the same way (a textarea exposes no
 * caret geometry). Used to float the formatting toolbar over the selection.
 */

/** Styles that decide where the text wraps and how tall its lines are. */
const MIRRORED = [
  'direction',
  'boxSizing',
  'width',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'fontFamily',
  'fontFeatureSettings',
  'fontKerning',
  'lineHeight',
  'textAlign',
  'textTransform',
  'textIndent',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'wordBreak',
] as const;

export interface CaretPoint {
  /** px from the field's top-left border corner, scrolling not applied. */
  top: number;
  left: number;
  /** The line's height. */
  height: number;
}

/**
 * The caret position before character `position` of `el` (one mirror per call; for both ends
 * of a selection use `selectionPoints`).
 */
export function caretPoint(el: HTMLTextAreaElement, position: number): CaretPoint {
  return measure(el, [position])[0]!;
}

/** The caret positions at both ends of `[start, end)`, from one mirror. */
export function selectionPoints(
  el: HTMLTextAreaElement,
  start: number,
  end: number,
): [CaretPoint, CaretPoint] {
  const [a, b] = measure(el, [start, end]);
  return [a!, b!];
}

function measure(el: HTMLTextAreaElement, positions: number[]): CaretPoint[] {
  const doc = el.ownerDocument;
  const cs = doc.defaultView!.getComputedStyle(el);
  const mirror = doc.createElement('div');
  const style = mirror.style;
  for (const p of MIRRORED) style[p] = cs[p];
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.top = '0';
  style.left = '-9999px';
  style.whiteSpace = 'pre-wrap';
  style.overflowWrap = 'break-word';
  // A visible scrollbar narrows the text: give the mirror one too.
  style.overflowY = el.scrollHeight > el.clientHeight ? 'scroll' : 'hidden';
  const value = el.value;
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  mirror.append(doc.createTextNode(value.slice(0, sorted[0])));
  // Each position starts a span holding the text up to the next one, so the mirror's lines
  // wrap exactly like the field's; the span's offset is where the caret would be drawn.
  const spans = new Map<number, HTMLSpanElement>();
  sorted.forEach((at, i) => {
    const span = doc.createElement('span');
    span.textContent = value.slice(at, sorted[i + 1] ?? value.length) || '.';
    mirror.append(span);
    spans.set(at, span);
  });
  doc.body.append(mirror);
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.375 || 20;
  const borderTop = parseFloat(cs.borderTopWidth) || 0;
  const borderLeft = parseFloat(cs.borderLeftWidth) || 0;
  try {
    return positions.map((at) => {
      const span = spans.get(at)!;
      return {
        top: span.offsetTop + borderTop,
        left: span.offsetLeft + borderLeft,
        height: lineHeight,
      };
    });
  } finally {
    mirror.remove();
  }
}

/**
 * The on-screen box (viewport px) of the selection's first line, for anchoring a toolbar
 * over it; kept inside the field's visible area when the selection is scrolled out of it.
 */
export function selectionAnchorRect(
  el: HTMLTextAreaElement,
  start: number,
  end: number,
): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
  const box = el.getBoundingClientRect();
  const [a, b] = selectionPoints(el, start, end);
  const top = Math.min(Math.max(box.top + a.top - el.scrollTop, box.top), box.bottom - a.height);
  const left = box.left + a.left - el.scrollLeft;
  // On one line: from end to end; across lines: the first line, to the field's right edge.
  const right = a.top === b.top ? box.left + b.left - el.scrollLeft : box.right;
  return {
    left: Math.min(left, right),
    right: Math.max(left, right),
    top,
    bottom: top + a.height,
    width: Math.abs(right - left),
    height: a.height,
  };
}
