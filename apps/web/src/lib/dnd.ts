/**
 * Drag-and-drop helpers shared by the Space rail and the channel list (dnd-kit core; the
 * lists show a drop indicator line instead of shifting rows, like Discord).
 *
 * - `useDragSensors`: the mouse starts a drag after a few pixels (clicks still click), touch
 *   after a long press (the list still scrolls), the keyboard with Space (Enter keeps opening
 *   links); arrows move the dragged item up and down.
 * - `pointCollision`: the droppable under the pointer (keyboard: under the dragged item's
 *   centre), else the nearest one vertically, so gaps between rows still count; the point and
 *   the rect go along for the zone math (`dropZone`). Read them with `collisionTarget` (the
 *   events' `over` lags a render behind their `collisions`).
 * - `pointerListeners`: a draggable's mouse and touch listeners only, for buttons (their Space
 *   and Enter keep pressing them; the keyboard has another way to move the item).
 * - `suppressClickAfterDrag`: the click that follows a drop never opens what was dragged.
 * - `inActiveDrag`: a long press that started a touch drag also fires `contextmenu`; the
 *   list's container carries `data-dragging="true"` meanwhile and menus ignore it.
 */
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type ClientRect,
  type Collision,
  type CollisionDetection,
  type DraggableSyntheticListeners,
  type KeyboardCoordinateGetter,
  type Over,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';

/** Space starts and drops (Enter would also follow the dragged link), Escape cancels. */
const KEYS = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] };

/** Up/down arrows move the dragged item by `step` px (lists are vertical). */
export function verticalKeyboardCoordinates(step: number): KeyboardCoordinateGetter {
  return (event, { currentCoordinates }) => {
    if (event.code === 'ArrowDown') return { ...currentCoordinates, y: currentCoordinates.y + step };
    if (event.code === 'ArrowUp') return { ...currentCoordinates, y: currentCoordinates.y - step };
    return undefined;
  };
}

/** Sensors of a vertical list whose rows are also links and buttons (see the file comment). */
export function useDragSensors(keyboardStep: number) {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: KEYS,
      coordinateGetter: verticalKeyboardCoordinates(keyboardStep),
    }),
  );
}

/** Only the mouse and touch listeners of a draggable (see the file comment). */
export function pointerListeners(listeners: DraggableSyntheticListeners): NonNullable<DraggableSyntheticListeners> {
  const out: NonNullable<DraggableSyntheticListeners> = {};
  if (listeners?.onMouseDown) out.onMouseDown = listeners.onMouseDown;
  if (listeners?.onTouchStart) out.onTouchStart = listeners.onTouchStart;
  return out;
}

export interface CollisionTarget<T> {
  /** Pointer (or dragged centre) in viewport coordinates. */
  point: { x: number; y: number };
  /** The droppable's rect. */
  rect: ClientRect;
  /** The droppable's `data`. */
  data: T;
}

/** The droppable `pointCollision` found, with the point and its rect (null when nothing is near). */
export function collisionTarget<T>(collisions: Collision[] | null | undefined): CollisionTarget<T> | null {
  const c = collisions?.[0]?.data as
    | { point?: CollisionTarget<T>['point']; rect?: ClientRect; droppableContainer?: { data: { current?: unknown } } }
    | undefined;
  const data = c?.droppableContainer?.data.current as T | undefined;
  return c?.point && c.rect && data ? { point: c.point, rect: c.rect, data } : null;
}

/**
 * The droppable under the point, else the vertically nearest one within `maxGap` px whose
 * column the point is in (± `slack` px sideways).
 */
export function pointCollision({ maxGap = 40, slack = 24 }: { maxGap?: number; slack?: number } = {}): CollisionDetection {
  return ({ droppableContainers, droppableRects, pointerCoordinates, collisionRect }) => {
    const point = pointerCoordinates ?? {
      x: collisionRect.left + collisionRect.width / 2,
      y: collisionRect.top + collisionRect.height / 2,
    };
    let best: Collision | null = null;
    let bestGap = Infinity;
    for (const container of droppableContainers) {
      const rect = droppableRects.get(container.id);
      if (!rect) continue;
      if (point.x < rect.left - slack || point.x > rect.left + rect.width + slack) continue;
      const gap = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
      if (gap < bestGap) {
        bestGap = gap;
        best = { id: container.id, data: { droppableContainer: container, value: gap, point, rect } };
      }
    }
    return best && bestGap <= maxGap ? [best] : [];
  };
}

export type DropZone = 'before' | 'middle' | 'after';

/**
 * Where `y` falls on a row: within `edge` (share of its height) of its top or bottom edge,
 * else the middle. `edge` 0.5 splits it in halves (no middle).
 */
export function dropZone(y: number, rect: Pick<ClientRect, 'top' | 'height'>, edge = 0.25): DropZone {
  const at = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
  if (at < edge) return 'before';
  if (at >= 1 - edge) return 'after';
  return 'middle';
}

const labelOf = (x: Active | Over | null) => (x?.data.current as { label?: string } | undefined)?.label ?? 'item';

/**
 * Screen reader text of a list's drags: draggables and droppables carry a `label` in their
 * data ("general", "Gaming Lounge").
 */
export const dndAccessibility: { announcements: Announcements; screenReaderInstructions: ScreenReaderInstructions } = {
  screenReaderInstructions: {
    draggable:
      'To move it, press Space. While moving, use the up and down arrow keys, then press Space again to drop it, or Escape to cancel.',
  },
  announcements: {
    onDragStart: ({ active }) => `Picked up ${labelOf(active)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${labelOf(active)} is over ${labelOf(over)}.` : `${labelOf(active)} is not over a place to drop.`,
    onDragEnd: ({ active, over }) => (over ? `${labelOf(active)} was dropped at ${labelOf(over)}.` : `${labelOf(active)} was dropped.`),
    onDragCancel: ({ active }) => `Moving ${labelOf(active)} was cancelled.`,
  },
};

/** The element is inside a list being dragged in (its container has `data-dragging="true"`). */
export function inActiveDrag(el: Element): boolean {
  return !!el.closest('[data-dragging="true"]');
}

/**
 * Swallow the click that may follow a drop (the pointer was released over a link: without
 * this it would open what was just dragged, or follow its href with a full page load).
 */
export function suppressClickAfterDrag(ms = 120): void {
  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), ms);
}
