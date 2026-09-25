/** WhatsApp-style attachment menu (colored round icons). */
import {
  BarChart3,
  Camera,
  FileText,
  Headphones,
  Image,
  MapPin,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Popover } from '../Popover';

export type AttachKind =
  'document' | 'media' | 'camera' | 'audio' | 'location' | 'contact' | 'poll';

const ITEMS: { kind: AttachKind; label: string; icon: LucideIcon; color: string }[] = [
  { kind: 'document', label: 'Document', icon: FileText, color: '#7f66ff' },
  { kind: 'media', label: 'Photos & videos', icon: Image, color: '#007bfc' },
  { kind: 'camera', label: 'Camera', icon: Camera, color: '#ff2e74' },
  { kind: 'audio', label: 'Audio', icon: Headphones, color: '#fa6533' },
  { kind: 'location', label: 'Location', icon: MapPin, color: '#1fa855' },
  { kind: 'contact', label: 'Contact', icon: UserRound, color: '#009de2' },
  { kind: 'poll', label: 'Poll', icon: BarChart3, color: '#ffbc38' },
];

/** ↑/↓/←/→ move between items (a grid on phones, a list on wider screens), Home/End jump. */
function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  const items = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  );
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  let next: number | null = null;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = i + 1;
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = i - 1;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  if (next === null || !items.length) return;
  e.preventDefault();
  items[(next + items.length) % items.length]?.focus();
}

export function AttachMenu({
  anchor,
  onClose,
  onPick,
  hide = [],
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  onPick: (kind: AttachKind) => void;
  hide?: AttachKind[];
}) {
  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} aria-label="Attach" className="p-2">
      <div
        role="menu"
        aria-label="Attach"
        onKeyDown={onMenuKeyDown}
        className="grid w-[min(320px,calc(100vw-24px))] grid-cols-4 gap-1 sm:w-auto sm:grid-cols-1"
      >
        {ITEMS.filter((i) => !hide.includes(i.kind)).map((item) => (
          <button
            key={item.kind}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onPick(item.kind);
            }}
            className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-2 text-[12px] text-fg outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:flex-row sm:gap-3 sm:px-3 sm:text-[14.5px]"
          >
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-white sm:size-8"
              style={{ backgroundColor: item.color }}
            >
              <item.icon size={20} strokeWidth={2} aria-hidden />
            </span>
            <span className="text-center sm:pr-4 sm:text-left">{item.label}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}
