import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Button, Modal, Spinner, toast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampCrop,
  cropRect,
  initialCrop,
  loadImage,
  renderAvatar,
  uploadAvatar,
  zoomCrop,
  type CropState,
  type ImageSize,
} from './avatar';

const VIEWPORT = 280;

export interface AvatarCropDialogProps {
  /** The picked image; the dialog is open while set. */
  file: File | null;
  onClose: () => void;
  onDone?: () => void;
}

/**
 * Square crop editor for profile photos: drag to move, wheel / pinch / slider to zoom,
 * arrow keys and +/- for keyboard users. "Set photo" renders, uploads and saves it.
 */
export function AvatarCropDialog({ file, onClose, onDone }: AvatarCropDialogProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState<ImageSize | null>(null);
  const [crop, setCrop] = useState<CropState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ crop: CropState; x: number; y: number; dist: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    let cancelled = false;
    setSrc(url);
    setError(null);
    setImg(null);
    setSize(null);
    setCrop(null);
    loadImage(url)
      .then((el) => {
        if (cancelled) return;
        const natural = { width: el.naturalWidth, height: el.naturalHeight };
        setImg(el);
        setSize(natural);
        setCrop(initialCrop(natural, VIEWPORT));
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const close = () => {
    if (!busy) onClose();
  };

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = viewportRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };

  const startGesture = () => {
    if (!crop) return;
    const pts = [...pointers.current.values()];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0;
    gesture.current = { crop, x: cx, y: cy, dist };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!crop || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, localPoint(e));
    startGesture();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current || !size) return;
    pointers.current.set(e.pointerId, localPoint(e));
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    let next: CropState = { ...g.crop, x: g.crop.x + (cx - g.x), y: g.crop.y + (cy - g.y) };
    if (pts.length > 1 && g.dist > 0) {
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      next = zoomCrop(next, g.crop.zoom * (dist / g.dist), size, VIEWPORT, { x: cx, y: cy });
    }
    setCrop(clampCrop(next, size, VIEWPORT));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) startGesture();
    else gesture.current = null;
  };

  // Wheel zoom around the cursor (non-passive so the page doesn't scroll).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !size) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
      setCrop((c) =>
        c ? zoomCrop(c, c.zoom * Math.exp(-e.deltaY * 0.0015), size, VIEWPORT, anchor) : c,
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [size]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!crop || !size) return;
    const step = e.shiftKey ? 40 : 10;
    let next: CropState | null = null;
    if (e.key === 'ArrowLeft') next = { ...crop, x: crop.x + step };
    else if (e.key === 'ArrowRight') next = { ...crop, x: crop.x - step };
    else if (e.key === 'ArrowUp') next = { ...crop, y: crop.y + step };
    else if (e.key === 'ArrowDown') next = { ...crop, y: crop.y - step };
    else if (e.key === '+' || e.key === '=') next = zoomCrop(crop, crop.zoom * 1.1, size, VIEWPORT);
    else if (e.key === '-') next = zoomCrop(crop, crop.zoom / 1.1, size, VIEWPORT);
    if (!next) return;
    e.preventDefault();
    setCrop(clampCrop(next, size, VIEWPORT));
  };

  const save = async () => {
    if (!img || !size || !crop) return;
    setBusy(true);
    setProgress(0);
    try {
      const { blob, size: out } = await renderAvatar(img, cropRect(crop, size, VIEWPORT));
      await uploadAvatar(blob, out, setProgress);
      toast.success('Profile photo updated');
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const scale = size && crop ? (VIEWPORT / Math.min(size.width, size.height)) * crop.zoom : 1;

  return (
    <Modal
      open={!!file}
      onClose={close}
      title="Crop your photo"
      description="Drag to reposition. Scroll or pinch to zoom."
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!crop}>
            {busy ? `Uploading ${Math.round(progress * 100)}%` : 'Set photo'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 py-2">
        <div
          ref={viewportRef}
          role="application"
          aria-label="Photo crop area. Use arrow keys to move and plus or minus to zoom."
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative touch-none overflow-hidden rounded-2xl bg-neutral-900 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          style={{ width: VIEWPORT, height: VIEWPORT, cursor: crop ? 'grab' : 'default' }}
        >
          {src && size && crop ? (
            <img
              src={src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
              style={{
                width: size.width * scale,
                height: size.height * scale,
                transform: `translate3d(${crop.x}px, ${crop.y}px, 0)`,
              }}
            />
          ) : error ? (
            <p className="flex size-full items-center justify-center p-6 text-center text-sm text-white/80">
              {error}
            </p>
          ) : (
            <div className="flex size-full items-center justify-center text-white/80">
              <Spinner />
            </div>
          )}
          {/* Circular mask */}
          <div
            className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80"
            style={{ boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.5)' }}
            aria-hidden
          />
        </div>
        <label className="flex w-full max-w-[280px] items-center gap-3 text-muted">
          <ZoomOut size={18} aria-hidden />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop?.zoom ?? 1}
            disabled={!crop || busy}
            onChange={(e) =>
              size && setCrop((c) => (c ? zoomCrop(c, Number(e.target.value), size, VIEWPORT) : c))
            }
            aria-label="Zoom"
            className="h-1.5 flex-1 cursor-pointer accent-[var(--brand)]"
          />
          <ZoomIn size={18} aria-hidden />
        </label>
      </div>
    </Modal>
  );
}
