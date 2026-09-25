/**
 * Square avatar cropper: drag to reposition, slider / wheel / keyboard to zoom. The result is
 * re-encoded through a canvas (strips EXIF/GPS, ≤ AVATAR_MAX_DIMENSION) as a JPEG blob.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button, Modal, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampOffset,
  clampZoom,
  coverScale,
  cropRect,
  zoomAt,
  type Point,
  type Size,
} from './crop';

const VIEW = 288;

export interface AvatarCropModalProps {
  file: File | null;
  onCancel: () => void;
  onDone: (blob: Blob) => void | Promise<void>;
  /** Rounded square (communities) instead of a circle mask. */
  shape?: 'circle' | 'square';
  title?: string;
}

export function AvatarCropModal({
  file,
  onCancel,
  onDone,
  shape = 'circle',
  title = 'Drag the image to adjust',
}: AvatarCropModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; start: Point } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setImg(null);
    setError(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setError("This image can't be opened. Try a JPEG or PNG.");
    el.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const size: Size | null = useMemo(
    () => (img ? { width: img.naturalWidth, height: img.naturalHeight } : null),
    [img],
  );
  const scale = size ? coverScale(size, VIEW) * zoom : 1;

  const setZoomAround = (next: number, anchor?: Point) => {
    if (!size) return;
    const z = clampZoom(next);
    setOffset((o) => zoomAt(o, size, VIEW, zoom, z, anchor));
    setZoom(z);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!size) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: offset };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !size) return;
    setOffset(
      clampOffset(
        { x: d.start.x + e.clientX - d.x, y: d.start.y + e.clientY - d.y },
        size,
        VIEW,
        zoom,
      ),
    );
  };
  const endDrag = () => {
    drag.current = null;
  };

  // Wheel zoom needs a non-passive listener to prevent page scroll.
  useEffect(() => {
    const el = viewRef.current;
    if (!el || !size) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const anchor = { x: e.clientX - r.left - VIEW / 2, y: e.clientY - r.top - VIEW / 2 };
      const next = clampZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      setOffset((o) => zoomAt(o, size, VIEW, zoom, next, anchor));
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [size, zoom]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!size) return;
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, Point> = {
      ArrowLeft: { x: step, y: 0 },
      ArrowRight: { x: -step, y: 0 },
      ArrowUp: { x: 0, y: step },
      ArrowDown: { x: 0, y: -step },
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      setOffset((o) => clampOffset({ x: o.x + m.x, y: o.y + m.y }, size, VIEW, zoom));
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setZoomAround(zoom + 0.25);
    } else if (e.key === '-') {
      e.preventDefault();
      setZoomAround(zoom - 0.25);
    }
  };

  const done = async () => {
    if (!img || !size) return;
    setBusy(true);
    try {
      const r = cropRect(size, VIEW, zoom, offset);
      const canvas = document.createElement('canvas');
      canvas.width = r.out;
      canvas.height = r.out;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, r.out, r.out);
      ctx.drawImage(img, r.sx, r.sy, r.size, r.size, 0, 0, r.out, r.out);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9),
      );
      if (!blob) throw new Error("Couldn't process the image");
      await onDone(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't process the image");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!file}
      onClose={busy ? () => undefined : onCancel}
      title={title}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void done()} loading={busy} disabled={!img}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 pb-2">
        <div
          ref={viewRef}
          role="img"
          aria-label="Crop area. Drag or use the arrow keys to move, + and − to zoom."
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="relative shrink-0 cursor-grab touch-none overflow-hidden rounded-2xl bg-black outline-none select-none focus-visible:ring-3 focus-visible:ring-brand/40 active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
        >
          {url && size ? (
            <img
              src={url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-1/2 left-1/2 max-w-none"
              style={{
                width: size.width * scale,
                height: size.height * scale,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          ) : error ? null : (
            <div className="flex size-full items-center justify-center text-white/80">
              <Spinner />
            </div>
          )}
          {/* Mask: darken outside the avatar shape. */}
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 ring-[400px] ring-black/55',
              shape === 'circle' ? 'rounded-full' : 'rounded-[28%]',
            )}
          >
            <div
              className={cn(
                'size-full border-2 border-white/85',
                shape === 'circle' ? 'rounded-full' : 'rounded-[28%]',
              )}
            />
          </div>
          {error ? (
            <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex w-full max-w-[288px] items-center gap-3 text-muted">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoomAround(zoom - 0.25)}
            className="rounded-full p-1 hover:bg-hover hover:text-fg"
          >
            <Minus size={18} aria-hidden />
          </button>
          <input
            type="range"
            aria-label="Zoom"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={!img}
            onChange={(e) => setZoomAround(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-[var(--brand)]"
          />
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoomAround(zoom + 0.25)}
            className="rounded-full p-1 hover:bg-hover hover:text-fg"
          >
            <Plus size={18} aria-hidden />
          </button>
        </div>
      </div>
    </Modal>
  );
}
