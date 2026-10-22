import { useMemo, useRef, useState, type DragEvent } from 'react';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Drag-and-drop target for one image file: `over` while files hover it, `onFile` with the
 * first dropped file (the caller validates it and opens its crop flow).
 */
export function useImageDrop(onFile: (file: File) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;
  const props = useMemo(
    () => ({
      onDragEnter: (e: DragEvent<HTMLElement>) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        onFileRef.current(file);
      },
    }),
    [],
  );
  return { over, props };
}
