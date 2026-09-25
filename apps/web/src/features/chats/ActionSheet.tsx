import type { ReactNode } from 'react';
import { Modal, type MenuEntry, type MenuItem } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Content above the actions (e.g. a quick-reactions strip). */
  header?: ReactNode;
  items: MenuEntry[];
  'aria-label'?: string;
}

/** Touch action list (long-press menus): bottom sheet on phones, small card on larger screens. */
export function ActionSheet({ open, onClose, title, header, items, ...aria }: ActionSheetProps) {
  const entries = items.filter((e): e is MenuItem | 'separator' => !!e);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      hideClose
      size="sm"
      aria-label={aria['aria-label'] ?? (typeof title === 'string' ? title : 'Actions')}
    >
      {/* The modal body has fixed padding (no class merging): bleed to the edges. */}
      <div className="-mx-6 -mt-1 -mb-1">
        {header ? <div className="px-4 pb-2">{header}</div> : null}
        <div role="menu" className="flex flex-col">
          {entries.map((entry, i) =>
            entry === 'separator' ? (
              <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-line" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                onClick={() => {
                  onClose();
                  entry.onSelect();
                }}
                className={cn(
                  'flex w-full items-center gap-4 px-6 py-3 text-left text-[15px] outline-none',
                  'hover:bg-hover focus-visible:bg-hover active:bg-hover disabled:opacity-45',
                  entry.danger ? 'text-danger' : 'text-fg',
                )}
              >
                {entry.icon ? (
                  <entry.icon
                    size={20}
                    strokeWidth={1.9}
                    className={entry.danger ? '' : 'text-muted'}
                    aria-hidden
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.hint ? <span className="text-xs text-subtle">{entry.hint}</span> : null}
              </button>
            ),
          )}
        </div>
      </div>
    </Modal>
  );
}
